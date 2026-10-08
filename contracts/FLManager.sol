// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRewardToken {
    function mint(address to, uint256 amount) external;
}

/// @dev Oracle (Chainlink) xác thực dữ liệu cảm biến ngoài chuỗi cho (node, round)
interface ISensorOracle {
    function isVerified(address node, uint256 roundId) external view returns (bool);
}

/// @title FLManager - điều phối Federated Learning on-chain (BlockFL)
/// @notice On-chain KHÔNG lưu trọng số mô hình (quá đắt). Mỗi node chỉ gửi:
///         hash(Δw) + CID IPFS (nếu có) + số mẫu + loss/accuracy cục bộ.
///         Contract tính FedAvg trọng số theo số mẫu cho các chỉ số (loss, acc),
///         tạo "cam kết" global model (globalModelHash) và chia thưởng token.
contract FLManager is Ownable, ReentrancyGuard {
    // ───────────────────────── Kiểu dữ liệu ─────────────────────────
    enum RoundStatus { None, Open, Finalized }

    struct Node {
        bool registered;
        bool active;
        string metadata;        // vd: "ESP32-01|BME280+MQ135|Q1 HCMC"
        uint64 registeredAt;
        uint32 totalUpdates;
        uint256 totalRewards;
    }

    struct Update {
        address node;
        bytes32 deltaHash;      // keccak256(Δw) tính off-chain
        string cid;             // IPFS CID của file Δw (có thể rỗng)
        uint32 numSamples;      // n_i - trọng số FedAvg
        uint32 lossE4;          // loss * 1e4
        uint32 accBps;          // accuracy * 1e4 (0..10000)
        uint64 timestamp;
    }

    struct Round {
        RoundStatus status;
        uint64 startedAt;
        uint64 finalizedAt;
        uint32 updateCount;
        uint256 totalSamples;
        uint256 rewardPool;
        bytes32 globalModelHash; // cam kết global model sau vòng này
        uint32 avgLossE4;        // FedAvg(loss)
        uint32 avgAccBps;        // FedAvg(acc)
    }

    // ───────────────────────── Trạng thái ─────────────────────────
    IRewardToken public immutable rewardToken;
    ISensorOracle public sensorOracle;      // address(0) = không bắt buộc xác thực oracle
    uint32 public minUpdates = 3;           // ≥ 3 node mỗi vòng (theo yêu cầu đề tài)
    uint32 public constant MAX_NODES_PER_ROUND = 64;

    uint256 public currentRound;            // 0 = chưa có vòng nào
    bytes32 public latestGlobalHash;        // global model hash mới nhất

    address[] private _nodeList;
    mapping(address => Node) private _nodes;
    mapping(uint256 => Round) private _rounds;
    mapping(uint256 => Update[]) private _updates;
    mapping(uint256 => mapping(address => bool)) public hasSubmitted;

    // ───────────────────────── Sự kiện ─────────────────────────
    event NodeRegistered(address indexed node, string metadata);
    event NodeStatusChanged(address indexed node, bool active);
    event RoundStarted(uint256 indexed roundId, uint256 rewardPool, uint64 startedAt);
    event UpdateSubmitted(
        uint256 indexed roundId, address indexed node, bytes32 deltaHash, string cid,
        uint32 numSamples, uint32 lossE4, uint32 accBps
    );
    event RoundFinalized(
        uint256 indexed roundId, bytes32 globalModelHash, uint32 avgLossE4, uint32 avgAccBps,
        uint32 updateCount, uint256 totalSamples
    );
    event RewardPaid(uint256 indexed roundId, address indexed node, uint256 amount);
    event OracleChanged(address oracle);
    event MinUpdatesChanged(uint32 minUpdates);

    constructor(address rewardToken_, address initialOwner) Ownable(initialOwner) {
        require(rewardToken_ != address(0), "token=0");
        rewardToken = IRewardToken(rewardToken_);
    }

    // ───────────────────────── Quản trị ─────────────────────────
    function setSensorOracle(address oracle) external onlyOwner {
        sensorOracle = ISensorOracle(oracle);
        emit OracleChanged(oracle);
    }

    function setMinUpdates(uint32 n) external onlyOwner {
        require(n >= 1 && n <= MAX_NODES_PER_ROUND, "bad min");
        minUpdates = n;
        emit MinUpdatesChanged(n);
    }

    function setNodeActive(address node, bool active) external onlyOwner {
        require(_nodes[node].registered, "not registered");
        _nodes[node].active = active;
        emit NodeStatusChanged(node, active);
    }

    // ───────────────────────── Node ─────────────────────────
    function registerNode(string calldata metadata) external {
        Node storage n = _nodes[msg.sender];
        require(!n.registered, "already registered");
        require(bytes(metadata).length <= 128, "metadata too long");
        n.registered = true;
        n.active = true;
        n.metadata = metadata;
        n.registeredAt = uint64(block.timestamp);
        _nodeList.push(msg.sender);
        emit NodeRegistered(msg.sender, metadata);
    }

    // ───────────────────────── Vòng FL ─────────────────────────
    function startRound(uint256 rewardPool) external onlyOwner returns (uint256 roundId) {
        if (currentRound != 0) {
            require(_rounds[currentRound].status == RoundStatus.Finalized, "previous round open");
        }
        roundId = ++currentRound;
        _rounds[roundId] = Round({
            status: RoundStatus.Open,
            startedAt: uint64(block.timestamp),
            finalizedAt: 0,
            updateCount: 0,
            totalSamples: 0,
            rewardPool: rewardPool,
            globalModelHash: bytes32(0),
            avgLossE4: 0,
            avgAccBps: 0
        });
        emit RoundStarted(roundId, rewardPool, uint64(block.timestamp));
    }

    /// @notice Node gửi hash(∆w) sau khi huấn luyện cục bộ xong một vòng
    function submitUpdate(
        bytes32 deltaHash,
        string calldata cid,
        uint32 numSamples,
        uint32 lossE4,
        uint32 accBps
    ) external {
        uint256 rid = currentRound;
        Round storage r = _rounds[rid];
        require(r.status == RoundStatus.Open, "no open round");
        Node storage n = _nodes[msg.sender];
        require(n.registered && n.active, "node not allowed");
        require(!hasSubmitted[rid][msg.sender], "already submitted");
        require(r.updateCount < MAX_NODES_PER_ROUND, "round full");
        require(deltaHash != bytes32(0), "empty hash");
        require(numSamples > 0, "no samples");
        require(accBps <= 10_000, "acc>100%");
        if (address(sensorOracle) != address(0)) {
            require(sensorOracle.isVerified(msg.sender, rid), "sensor data not verified");
        }

        hasSubmitted[rid][msg.sender] = true;
        _updates[rid].push(Update({
            node: msg.sender,
            deltaHash: deltaHash,
            cid: cid,
            numSamples: numSamples,
            lossE4: lossE4,
            accBps: accBps,
            timestamp: uint64(block.timestamp)
        }));
        r.updateCount += 1;
        r.totalSamples += numSamples;
        n.totalUpdates += 1;

        emit UpdateSubmitted(rid, msg.sender, deltaHash, cid, numSamples, lossE4, accBps);
    }

    /// @notice Tổng hợp FedAvg (chỉ số) + cam kết global model + chia thưởng theo số mẫu
    function finalizeRound() external onlyOwner nonReentrant {
        uint256 rid = currentRound;
        Round storage r = _rounds[rid];
        require(r.status == RoundStatus.Open, "no open round");
        require(r.updateCount >= minUpdates, "not enough updates");

        Update[] storage ups = _updates[rid];
        uint256 total = r.totalSamples;
        uint256 lossAcc;
        uint256 accAcc;
        bytes memory commit = abi.encodePacked(latestGlobalHash, rid);

        for (uint256 i = 0; i < ups.length; i++) {
            Update storage u = ups[i];
            lossAcc += uint256(u.lossE4) * u.numSamples;
            accAcc += uint256(u.accBps) * u.numSamples;
            commit = abi.encodePacked(commit, u.deltaHash, u.numSamples);
        }

        bytes32 g = keccak256(commit);
        r.globalModelHash = g;
        r.avgLossE4 = uint32(lossAcc / total);
        r.avgAccBps = uint32(accAcc / total);
        r.status = RoundStatus.Finalized;
        r.finalizedAt = uint64(block.timestamp);
        latestGlobalHash = g;

        // chia thưởng tỉ lệ theo số mẫu: reward_i = pool * n_i / N
        if (r.rewardPool > 0) {
            for (uint256 i = 0; i < ups.length; i++) {
                Update storage u = ups[i];
                uint256 amt = (r.rewardPool * u.numSamples) / total;
                if (amt > 0) {
                    _nodes[u.node].totalRewards += amt;
                    rewardToken.mint(u.node, amt);
                    emit RewardPaid(rid, u.node, amt);
                }
            }
        }

        emit RoundFinalized(rid, g, r.avgLossE4, r.avgAccBps, r.updateCount, total);
    }

    // ───────────────────────── View ─────────────────────────
    function getNode(address node) external view returns (Node memory) { return _nodes[node]; }
    function getNodeList() external view returns (address[] memory) { return _nodeList; }
    function nodeCount() external view returns (uint256) { return _nodeList.length; }
    function getRound(uint256 roundId) external view returns (Round memory) { return _rounds[roundId]; }
    function getRoundUpdates(uint256 roundId) external view returns (Update[] memory) { return _updates[roundId]; }
}
