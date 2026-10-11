// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRewardTokenV2 {
    function mint(address to, uint256 amount) external;
}

interface ISensorOracleV2 {
    function isVerified(address node, uint256 roundId) external view returns (bool);
}

/// @title FLManagerV2 - điều phối Federated Learning có CỌC (stake), PHẠT (slash) và THƯỞNG THEO CHẤT LƯỢNG
/// @notice Bản nâng cấp của FLManager (bản đã deploy/verify trên Sepolia được giữ nguyên, không sửa).
///  - Node phải đặt cọc ETH (minStake) khi đăng ký. Cọc bị khóa trong thời gian unbonding khi rút.
///  - Phạt tự động: node có loss > median × outlierFactor bị đánh dấu "outlier" → bị loại khỏi tổng hợp,
///    không nhận thưởng và bị slash slashBps% cọc. Owner cũng có thể slash thủ công (kèm evidence hash).
///  - Thưởng: weight_i = min(nᵢ, maxSamples) × accuracyᵢ ; reward_i = pool × weight_i / Σ weight
///    (giới hạn nᵢ chống khai gian số mẫu; nhân accuracy để thưởng theo chất lượng).
///  - Tiền bị phạt gom vào slashedPool (kiểu pull), owner rút bằng withdrawSlashed - không có gọi ngoài trong vòng lặp.
contract FLManagerV2 is Ownable, ReentrancyGuard {
    enum RoundStatus { None, Open, Finalized }

    uint8 public constant REASON_OUTLIER = 1;
    uint8 public constant REASON_MANUAL = 2;
    uint32 public constant MAX_NODES_PER_ROUND = 64;

    struct Node {
        bool registered;
        bool active;
        string metadata;
        uint64 registeredAt;
        uint32 totalUpdates;
        uint32 flaggedCount;
        uint64 exitRequestedAt;   // 0 = không đang rút cọc
        uint256 stake;            // wei
        uint256 totalSlashed;     // wei
        uint256 totalRewards;     // BFL (wei)
    }

    struct Update {
        address node;
        bytes32 deltaHash;
        string cid;
        uint32 numSamples;
        uint32 lossE4;
        uint32 accBps;
        uint64 timestamp;
        bool flagged;             // được đặt khi finalizeRound
        uint256 reward;           // BFL nhận được (0 nếu bị loại)
    }

    struct Round {
        RoundStatus status;
        uint64 startedAt;
        uint64 finalizedAt;
        uint32 updateCount;
        uint32 flaggedCount;
        uint256 totalSamples;     // tổng nᵢ của các update được chấp nhận
        uint256 rewardPool;
        bytes32 globalModelHash;
        uint32 avgLossE4;
        uint32 avgAccBps;
        uint32 medianLossE4;
    }

    // ───────── cấu hình (owner chỉnh trong giới hạn) ─────────
    IRewardTokenV2 public immutable rewardToken;
    ISensorOracleV2 public sensorOracle;
    uint32 public minUpdates = 3;
    uint256 public minStake = 0.001 ether;
    uint16 public slashBps = 1000;                // 10% cọc cho mỗi lần bị đánh dấu outlier
    uint32 public outlierFactorBps = 20000;       // loss > 2.0 × median → outlier
    uint32 public maxSamplesPerRound = 5000;      // trần nᵢ khi tính trọng số
    uint64 public unbondingPeriod = 1 days;
    uint256 public slashedPool;                   // ETH bị phạt, chờ owner rút

    uint256 public currentRound;
    bytes32 public latestGlobalHash;

    address[] private _nodeList;
    mapping(address => Node) private _nodes;
    mapping(uint256 => Round) private _rounds;
    mapping(uint256 => Update[]) private _updates;
    mapping(uint256 => mapping(address => bool)) public hasSubmitted;

    event NodeRegistered(address indexed node, string metadata, uint256 stake);
    event StakeAdded(address indexed node, uint256 amount, uint256 totalStake);
    event NodeStatusChanged(address indexed node, bool active);
    event ExitRequested(address indexed node, uint64 availableAt);
    event StakeWithdrawn(address indexed node, uint256 amount);
    event Slashed(address indexed node, uint256 amount, uint8 reason, bytes32 evidence);
    event NodeFlagged(uint256 indexed roundId, address indexed node, uint32 lossE4, uint32 medianLossE4);
    event RoundStarted(uint256 indexed roundId, uint256 rewardPool, uint64 startedAt);
    event UpdateSubmitted(uint256 indexed roundId, address indexed node, bytes32 deltaHash, string cid, uint32 numSamples, uint32 lossE4, uint32 accBps);
    event RoundFinalized(uint256 indexed roundId, bytes32 globalModelHash, uint32 avgLossE4, uint32 avgAccBps, uint32 acceptedCount, uint32 flaggedCount, uint256 totalSamples);
    event RewardPaid(uint256 indexed roundId, address indexed node, uint256 amount);
    event ParamsChanged(uint256 minStake, uint16 slashBps, uint32 outlierFactorBps, uint32 maxSamplesPerRound, uint64 unbondingPeriod);
    event OracleChanged(address oracle);
    event MinUpdatesChanged(uint32 minUpdates);
    event SlashedWithdrawn(address indexed to, uint256 amount);

    constructor(address rewardToken_, address initialOwner) Ownable(initialOwner) {
        require(rewardToken_ != address(0), "token=0");
        rewardToken = IRewardTokenV2(rewardToken_);
    }

    // ───────────────── quản trị ─────────────────
    function setSensorOracle(address oracle) external onlyOwner { sensorOracle = ISensorOracleV2(oracle); emit OracleChanged(oracle); }

    function setMinUpdates(uint32 n) external onlyOwner {
        require(n >= 1 && n <= MAX_NODES_PER_ROUND, "bad min");
        minUpdates = n; emit MinUpdatesChanged(n);
    }

    function setParams(uint256 minStake_, uint16 slashBps_, uint32 outlierFactorBps_, uint32 maxSamples_, uint64 unbonding_) external onlyOwner {
        require(slashBps_ <= 10_000, "slash>100%");
        require(outlierFactorBps_ >= 10_000, "factor<1x");
        require(maxSamples_ > 0, "maxSamples=0");
        require(unbonding_ <= 30 days, "unbonding>30d");
        minStake = minStake_; slashBps = slashBps_; outlierFactorBps = outlierFactorBps_; maxSamplesPerRound = maxSamples_; unbondingPeriod = unbonding_;
        emit ParamsChanged(minStake_, slashBps_, outlierFactorBps_, maxSamples_, unbonding_);
    }

    function setNodeActive(address node, bool active) external onlyOwner {
        Node storage n = _nodes[node];
        require(n.registered, "not registered");
        require(!active || (n.stake >= minStake && n.exitRequestedAt == 0), "stake too low");
        n.active = active; emit NodeStatusChanged(node, active);
    }

    /// @notice Phạt thủ công (vd: bằng chứng node gửi Δw độc hại). bps ∈ (0, 10000].
    function slash(address node, uint16 bps, bytes32 evidence) external onlyOwner {
        require(_nodes[node].registered, "not registered");
        require(bps > 0 && bps <= 10_000, "bad bps");
        _slash(node, (_nodes[node].stake * bps) / 10_000, REASON_MANUAL, evidence);
    }

    function withdrawSlashed(address payable to) external onlyOwner nonReentrant {
        require(to != address(0), "to=0");
        uint256 amt = slashedPool;
        require(amt > 0, "nothing");
        slashedPool = 0;
        (bool ok, ) = to.call{value: amt}("");
        require(ok, "transfer failed");
        emit SlashedWithdrawn(to, amt);
    }

    // ───────────────── node: đăng ký, cọc, rút ─────────────────
    function registerNode(string calldata metadata) external payable {
        Node storage n = _nodes[msg.sender];
        require(!n.registered, "already registered");
        require(bytes(metadata).length <= 128, "metadata too long");
        require(msg.value >= minStake, "stake too low");
        n.registered = true; n.active = true; n.metadata = metadata;
        n.registeredAt = uint64(block.timestamp); n.stake = msg.value;
        _nodeList.push(msg.sender);
        emit NodeRegistered(msg.sender, metadata, msg.value);
    }

    /// @notice Nạp thêm cọc; nếu đủ minStake và không đang rút thì node hoạt động trở lại.
    function topUp() external payable {
        Node storage n = _nodes[msg.sender];
        require(n.registered, "not registered");
        require(msg.value > 0, "no value");
        n.stake += msg.value;
        emit StakeAdded(msg.sender, msg.value, n.stake);
        if (!n.active && n.exitRequestedAt == 0 && n.stake >= minStake) { n.active = true; emit NodeStatusChanged(msg.sender, true); }
    }

    function requestExit() external {
        Node storage n = _nodes[msg.sender];
        require(n.registered && n.exitRequestedAt == 0, "cannot exit");
        Round storage r = _rounds[currentRound];
        require(!(r.status == RoundStatus.Open && hasSubmitted[currentRound][msg.sender]), "update pending in open round");
        n.active = false; n.exitRequestedAt = uint64(block.timestamp);
        emit NodeStatusChanged(msg.sender, false);
        emit ExitRequested(msg.sender, uint64(block.timestamp) + unbondingPeriod);
    }

    function withdrawStake() external nonReentrant {
        Node storage n = _nodes[msg.sender];
        require(n.exitRequestedAt != 0, "exit not requested");
        require(block.timestamp >= n.exitRequestedAt + unbondingPeriod, "unbonding");
        uint256 amt = n.stake;
        require(amt > 0, "no stake");
        n.stake = 0; n.exitRequestedAt = 0;               // effects trước interactions
        (bool ok, ) = msg.sender.call{value: amt}("");
        require(ok, "transfer failed");
        emit StakeWithdrawn(msg.sender, amt);
    }

    // ───────────────── vòng FL ─────────────────
    function startRound(uint256 rewardPool) external onlyOwner returns (uint256 roundId) {
        if (currentRound != 0) require(_rounds[currentRound].status == RoundStatus.Finalized, "previous round open");
        roundId = ++currentRound;
        Round storage r = _rounds[roundId];
        r.status = RoundStatus.Open; r.startedAt = uint64(block.timestamp); r.rewardPool = rewardPool;
        emit RoundStarted(roundId, rewardPool, uint64(block.timestamp));
    }

    function submitUpdate(bytes32 deltaHash, string calldata cid, uint32 numSamples, uint32 lossE4, uint32 accBps) external {
        uint256 rid = currentRound;
        Round storage r = _rounds[rid];
        require(r.status == RoundStatus.Open, "no open round");
        Node storage n = _nodes[msg.sender];
        require(n.registered && n.active, "node not allowed");
        require(n.stake >= minStake, "stake too low");
        require(!hasSubmitted[rid][msg.sender], "already submitted");
        require(r.updateCount < MAX_NODES_PER_ROUND, "round full");
        require(deltaHash != bytes32(0), "empty hash");
        require(numSamples > 0, "no samples");
        require(accBps <= 10_000, "acc>100%");
        if (address(sensorOracle) != address(0)) require(sensorOracle.isVerified(msg.sender, rid), "sensor data not verified");

        hasSubmitted[rid][msg.sender] = true;
        _updates[rid].push(Update(msg.sender, deltaHash, cid, numSamples, lossE4, accBps, uint64(block.timestamp), false, 0));
        r.updateCount += 1;
        n.totalUpdates += 1;
        emit UpdateSubmitted(rid, msg.sender, deltaHash, cid, numSamples, lossE4, accBps);
    }

    /// @notice Chốt vòng: loại outlier + slash, FedAvg chỉ số trên update hợp lệ, cam kết global model, chia thưởng theo chất lượng.
    function finalizeRound() external onlyOwner nonReentrant {
        uint256 rid = currentRound;
        Round storage r = _rounds[rid];
        require(r.status == RoundStatus.Open, "no open round");
        require(r.updateCount >= minUpdates, "not enough updates");

        uint32 flagged = _flagAndSlash(rid);
        uint32 accepted = r.updateCount - flagged;
        require(accepted >= minUpdates, "not enough valid updates");

        uint256 sumW = _aggregate(rid);
        r.flaggedCount = flagged;
        r.status = RoundStatus.Finalized;
        r.finalizedAt = uint64(block.timestamp);
        if (r.rewardPool > 0 && sumW > 0) _payRewards(rid, sumW);
        emit RoundFinalized(rid, r.globalModelHash, r.avgLossE4, r.avgAccBps, accepted, flagged, r.totalSamples);
    }

    /// (1) median loss → đánh dấu outlier (loss > median × factor) → slash
    function _flagAndSlash(uint256 rid) internal returns (uint32 flagged) {
        Update[] storage ups = _updates[rid];
        uint256 len = ups.length;
        uint32[] memory losses = new uint32[](len);
        for (uint256 i = 0; i < len; i++) losses[i] = ups[i].lossE4;
        uint32 med = _median(losses);
        _rounds[rid].medianLossE4 = med;
        if (med == 0) return 0;
        for (uint256 i = 0; i < len; i++) {
            Update storage u = ups[i];
            if (uint256(u.lossE4) * 10_000 > uint256(med) * outlierFactorBps) {
                u.flagged = true;
                flagged++;
                _nodes[u.node].flaggedCount += 1;
                emit NodeFlagged(rid, u.node, u.lossE4, med);
                _slash(u.node, (_nodes[u.node].stake * slashBps) / 10_000, REASON_OUTLIER, keccak256(abi.encode(rid, u.deltaHash)));
            }
        }
    }

    /// (2) FedAvg chỉ số (trọng số nᵢ có trần) + cam kết global model, chỉ trên update hợp lệ. Trả Σ(nᵢ·accᵢ).
    function _aggregate(uint256 rid) internal returns (uint256 sumW) {
        Update[] storage ups = _updates[rid];
        Round storage r = _rounds[rid];
        uint256 lossAcc; uint256 accAcc; uint256 sumN;
        bytes memory commit = abi.encodePacked(latestGlobalHash, rid);
        for (uint256 i = 0; i < ups.length; i++) {
            Update storage u = ups[i];
            if (u.flagged) continue;
            uint256 n = _cappedSamples(u.numSamples);
            lossAcc += uint256(u.lossE4) * n;
            accAcc += uint256(u.accBps) * n;
            sumN += n;
            sumW += n * u.accBps;
            commit = abi.encodePacked(commit, u.deltaHash, u.numSamples);
        }
        bytes32 g = keccak256(commit);
        r.globalModelHash = g;
        latestGlobalHash = g;
        r.avgLossE4 = uint32(lossAcc / sumN);
        r.avgAccBps = uint32(accAcc / sumN);
        r.totalSamples = sumN;
    }

    /// (3) thưởng theo chất lượng: reward_i = pool × (min(nᵢ,cap) × accᵢ) / Σ
    function _payRewards(uint256 rid, uint256 sumW) internal {
        Update[] storage ups = _updates[rid];
        uint256 pool = _rounds[rid].rewardPool;
        for (uint256 i = 0; i < ups.length; i++) {
            Update storage u = ups[i];
            if (u.flagged) continue;
            uint256 amt = (pool * _cappedSamples(u.numSamples) * u.accBps) / sumW;
            if (amt == 0) continue;
            u.reward = amt;
            _nodes[u.node].totalRewards += amt;
            rewardToken.mint(u.node, amt);
            emit RewardPaid(rid, u.node, amt);
        }
    }

    function _cappedSamples(uint32 n) internal view returns (uint256) {
        return n > maxSamplesPerRound ? maxSamplesPerRound : n;
    }

    // ───────────────── nội bộ ─────────────────
    function _slash(address node, uint256 amount, uint8 reason, bytes32 evidence) internal {
        Node storage n = _nodes[node];
        if (amount > n.stake) amount = n.stake;
        n.stake -= amount; n.totalSlashed += amount; slashedPool += amount;
        emit Slashed(node, amount, reason, evidence);
        if (n.active && n.stake < minStake) { n.active = false; emit NodeStatusChanged(node, false); }
    }

    function _median(uint32[] memory a) internal pure returns (uint32) {
        uint256 n = a.length;
        for (uint256 i = 1; i < n; i++) {                       // insertion sort (n ≤ 64)
            uint32 k = a[i]; uint256 j = i;
            while (j > 0 && a[j - 1] > k) { a[j] = a[j - 1]; j--; }
            a[j] = k;
        }
        return n % 2 == 1 ? a[n / 2] : uint32((uint256(a[n / 2 - 1]) + a[n / 2]) / 2);
    }

    // ───────────────── view ─────────────────
    function getNode(address node) external view returns (Node memory) { return _nodes[node]; }
    function getNodeList() external view returns (address[] memory) { return _nodeList; }
    function nodeCount() external view returns (uint256) { return _nodeList.length; }
    function getRound(uint256 roundId) external view returns (Round memory) { return _rounds[roundId]; }
    function getRoundUpdates(uint256 roundId) external view returns (Update[] memory) { return _updates[roundId]; }
}
