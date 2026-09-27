// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./RewardToken.sol";

/**
 * @title FLManager
 * @notice Điều phối Federated Learning on-chain
 *         Nhận hash trọng số từ các edge node,
 *         xác nhận round hoàn thành và phân bổ token thưởng.
 */
contract FLManager is Ownable {
    // ─── Structs ──────────────────────────────────────────────────────────────
    struct Node {
        address addr;
        bool    registered;
        uint256 totalContributions;
    }

    struct Round {
        uint256 roundId;
        bytes32 globalModelHash;   // hash của global model sau aggregation
        uint256 contributorCount;
        bool    finalized;
        uint256 timestamp;
    }

    // ─── State variables ──────────────────────────────────────────────────────
    RewardToken public rewardToken;

    uint256 public currentRound;
    uint256 public minContributors;          // số node tối thiểu để finalize round
    uint256 public rewardPerContribution;    // token thưởng mỗi lần đóng góp (wei)

    mapping(address => Node)    public nodes;
    mapping(uint256 => Round)   public rounds;
    // roundId => node => đã gửi hash chưa
    mapping(uint256 => mapping(address => bool)) public submitted;
    // roundId => node => hash trọng số của node đó
    mapping(uint256 => mapping(address => bytes32)) public weightHashes;

    address[] public nodeList;

    // ─── Events ───────────────────────────────────────────────────────────────
    event NodeRegistered(address indexed node, uint256 timestamp);
    event WeightSubmitted(address indexed node, uint256 indexed roundId, bytes32 weightHash);
    event RoundFinalized(uint256 indexed roundId, bytes32 globalModelHash, uint256 contributors);
    event RewardDistributed(address indexed node, uint256 amount);

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(
        address _rewardToken,
        uint256 _minContributors,
        uint256 _rewardPerContribution
    ) Ownable(msg.sender) {
        rewardToken           = RewardToken(_rewardToken);
        minContributors       = _minContributors;
        rewardPerContribution = _rewardPerContribution;
        currentRound          = 1;
    }

    // ─── Modifiers ────────────────────────────────────────────────────────────
    modifier onlyRegistered() {
        require(nodes[msg.sender].registered, "FLManager: node chua dang ky");
        _;
    }

    // ─── Functions ────────────────────────────────────────────────────────────

    /**
     * @notice Đăng ký edge node tham gia Federated Learning
     */
    function registerNode(address _node) external onlyOwner {
        require(!nodes[_node].registered, "FLManager: da dang ky");
        nodes[_node] = Node({
            addr:               _node,
            registered:         true,
            totalContributions: 0
        });
        nodeList.push(_node);
        emit NodeRegistered(_node, block.timestamp);
    }

    /**
     * @notice Node gửi hash của local weight update lên chain
     * @param _weightHash keccak256(local_weights_bytes)
     */
    function submitWeightHash(bytes32 _weightHash) external onlyRegistered {
        uint256 rid = currentRound;
        require(!submitted[rid][msg.sender], "FLManager: da gui round nay");

        submitted[rid][msg.sender]    = true;
        weightHashes[rid][msg.sender] = _weightHash;
        rounds[rid].contributorCount  += 1;

        nodes[msg.sender].totalContributions += 1;

        emit WeightSubmitted(msg.sender, rid, _weightHash);

        // Auto-finalize nếu đủ contributor
        if (rounds[rid].contributorCount >= minContributors) {
            _finalizeRound(rid);
        }
    }

    /**
     * @notice Owner finalize round thủ công (nếu chưa auto)
     */
    function finalizeRound(bytes32 _globalModelHash) external onlyOwner {
        uint256 rid = currentRound;
        require(!rounds[rid].finalized, "FLManager: round da finalized");
        rounds[rid].globalModelHash = _globalModelHash;
        _finalizeRound(rid);
    }

    function _finalizeRound(uint256 rid) internal {
        require(!rounds[rid].finalized, "FLManager: da finalized");
        rounds[rid].finalized  = true;
        rounds[rid].timestamp  = block.timestamp;
        currentRound           += 1;

        // Phân bổ token thưởng cho các node đã đóng góp
        for (uint256 i = 0; i < nodeList.length; i++) {
            address node = nodeList[i];
            if (submitted[rid][node]) {
                rewardToken.mint(node, rewardPerContribution);
                emit RewardDistributed(node, rewardPerContribution);
            }
        }

        emit RoundFinalized(rid, rounds[rid].globalModelHash, rounds[rid].contributorCount);
    }

    // ─── View functions ───────────────────────────────────────────────────────
    function getRoundInfo(uint256 _roundId) external view returns (Round memory) {
        return rounds[_roundId];
    }

    function getNodeCount() external view returns (uint256) {
        return nodeList.length;
    }

    function hasSubmitted(uint256 _roundId, address _node) external view returns (bool) {
        return submitted[_roundId][_node];
    }
}
