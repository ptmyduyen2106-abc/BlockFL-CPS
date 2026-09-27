// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RewardToken (FLT)
 * @notice ERC-20 token thưởng cho các edge node đóng góp vào Federated Learning.
 *         Chỉ FLManager (owner) được phép mint.
 */
contract RewardToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10 ** 18; // 1 triệu FLT

    event TokensMinted(address indexed to, uint256 amount);

    constructor() ERC20("FL Reward Token", "FLT") Ownable(msg.sender) {}

    /**
     * @notice Mint token thưởng — chỉ owner (FLManager) được gọi
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "RewardToken: vuot qua max supply");
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }
}
