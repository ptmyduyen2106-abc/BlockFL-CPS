// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFLV2 {
    function registerNode(string calldata) external payable;
    function requestExit() external;
    function withdrawStake() external;
}

/// @dev CHỈ DÙNG ĐỂ TEST: node độc hại cố gọi lại withdrawStake() trong receive()
contract ReentrantNode {
    IFLV2 public fl;
    uint256 public reentries;
    bool public reentrySucceeded;

    constructor(address fl_) { fl = IFLV2(fl_); }

    function join() external payable { fl.registerNode{value: msg.value}("attacker"); }
    function exit() external { fl.requestExit(); }
    function pull() external { fl.withdrawStake(); }

    receive() external payable {
        reentries++;
        try fl.withdrawStake() { reentrySucceeded = true; } catch {}
    }
}
