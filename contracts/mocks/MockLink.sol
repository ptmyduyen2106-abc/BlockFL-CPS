// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ITokenReceiver { function onTokenTransfer(address from, uint256 amount, bytes calldata data) external; }

/// @dev CHỈ DÙNG ĐỂ TEST: giả lập LINK (ERC-677 transferAndCall)
contract MockLink is ERC20 {
    constructor() ERC20("MockLink", "mLINK") { _mint(msg.sender, 1_000_000 ether); }

    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool) {
        _transfer(msg.sender, to, value);
        if (to.code.length > 0) ITokenReceiver(to).onTokenTransfer(msg.sender, value, data);
        return true;
    }
}
