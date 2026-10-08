// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ChainlinkClient, Chainlink} from "@chainlink/contracts/src/v0.8/ChainlinkClient.sol";
import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";

/// @title SensorOracle - xác thực dữ liệu cảm biến ngoài chuỗi bằng Chainlink (TÙY CHỌN, +điểm)
/// @notice Luồng: owner gọi requestVerification(node, roundId, url) → Chainlink node (Operator)
///         gọi HTTP GET `url` (API trên RPi5/IPFS gateway trả JSON {"verified":0|1}) →
///         callback fulfill() ghi kết quả → FLManager.submitUpdate chỉ cho phép node đã verified.
/// @dev   `setManualVerification` là phương án DỰ PHÒNG khi demo không có Chainlink node/LINK.
contract SensorOracle is ChainlinkClient, ConfirmedOwner {
    using Chainlink for Chainlink.Request;

    struct Pending { address node; uint256 roundId; }

    bytes32 public jobId;
    uint256 public fee;
    mapping(bytes32 => Pending) public pending;
    mapping(address => mapping(uint256 => bool)) private _verified;

    event VerificationRequested(bytes32 indexed requestId, address indexed node, uint256 indexed roundId, string url);
    event VerificationFulfilled(bytes32 indexed requestId, address indexed node, uint256 indexed roundId, bool ok);
    event ManualVerification(address indexed node, uint256 indexed roundId, bool ok);

    constructor(address link, address operator, bytes32 jobId_, uint256 fee_) ConfirmedOwner(msg.sender) {
        _setChainlinkToken(link);
        _setChainlinkOracle(operator);
        jobId = jobId_;
        fee = fee_;
    }

    function requestVerification(address node, uint256 roundId, string calldata url)
        external onlyOwner returns (bytes32 requestId)
    {
        Chainlink.Request memory req = _buildChainlinkRequest(jobId, address(this), this.fulfill.selector);
        req._add("get", url);
        req._add("path", "verified");
        requestId = _sendChainlinkRequest(req, fee);
        pending[requestId] = Pending(node, roundId);
        emit VerificationRequested(requestId, node, roundId, url);
    }

    function fulfill(bytes32 requestId, uint256 result) external recordChainlinkFulfillment(requestId) {
        Pending memory p = pending[requestId];
        bool ok = result == 1;
        _verified[p.node][p.roundId] = ok;
        delete pending[requestId];
        emit VerificationFulfilled(requestId, p.node, p.roundId, ok);
    }

    function setManualVerification(address node, uint256 roundId, bool ok) external onlyOwner {
        _verified[node][roundId] = ok;
        emit ManualVerification(node, roundId, ok);
    }

    function setJob(bytes32 jobId_, uint256 fee_) external onlyOwner { jobId = jobId_; fee = fee_; }

    function isVerified(address node, uint256 roundId) external view returns (bool) {
        return _verified[node][roundId];
    }
}
