// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title RewardToken (BFL) - ERC-20 thưởng cho các node đóng góp trong Federated Learning
/// @notice Chỉ địa chỉ có MINTER_ROLE (chính là FLManager) mới được mint.
contract RewardToken is ERC20, ERC20Burnable, ERC20Capped, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @param admin   Địa chỉ quản trị (cấp/thu hồi MINTER_ROLE)
    /// @param cap_    Giới hạn tổng cung tối đa (đơn vị wei, 18 decimals)
    constructor(address admin, uint256 cap_) ERC20("BlockFL Reward", "BFL") ERC20Capped(cap_) {
        require(admin != address(0), "admin=0");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    // ---- bắt buộc override do đa kế thừa (ERC20 + ERC20Capped) ----
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }
}
