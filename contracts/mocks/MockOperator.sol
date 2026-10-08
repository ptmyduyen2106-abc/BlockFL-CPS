// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev CHỈ DÙNG ĐỂ TEST: giả lập Chainlink Operator nhận request & callback kết quả
contract MockOperator {
    struct Req { address callbackAddr; bytes4 callbackFn; }
    mapping(bytes32 => Req) public reqs;
    bytes32 public lastRequestId;

    function onTokenTransfer(address from, uint256, bytes calldata data) external {
        // data = selector(4) + abi.encode(sender, amount, specId, callbackAddr, callbackFn, nonce, dataVersion, bytes)
        (, , , address cbAddr, bytes4 cbFn, uint256 nonce, , ) =
            abi.decode(data[4:], (address, uint256, bytes32, address, bytes4, uint256, uint256, bytes));
        bytes32 requestId = keccak256(abi.encodePacked(from, nonce));
        reqs[requestId] = Req(cbAddr, cbFn);
        lastRequestId = requestId;
    }

    function fulfill(bytes32 requestId, uint256 result) external {
        Req memory r = reqs[requestId];
        (bool ok, ) = r.callbackAddr.call(abi.encodeWithSelector(r.callbackFn, requestId, result));
        require(ok, "callback failed");
    }
}
