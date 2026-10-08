const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RewardToken (ERC-20)", () => {
  let owner, minter, user, token;
  const CAP = ethers.parseEther("1000000");
  beforeEach(async () => {
    [owner, minter, user] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("RewardToken")).deploy(owner.address, CAP);
    await token.grantRole(await token.MINTER_ROLE(), minter.address);
  });

  it("metadata: tên, ký hiệu, decimals, cap", async () => {
    expect(await token.name()).to.equal("BlockFL Reward");
    expect(await token.symbol()).to.equal("BFL");
    expect(await token.decimals()).to.equal(18n);
    expect(await token.cap()).to.equal(CAP);
    expect(await token.totalSupply()).to.equal(0n);
  });

  it("MINTER_ROLE mint được và cộng đúng số dư", async () => {
    await token.connect(minter).mint(user.address, 100n);
    expect(await token.balanceOf(user.address)).to.equal(100n);
    expect(await token.totalSupply()).to.equal(100n);
  });

  it("người không có MINTER_ROLE bị revert", async () => {
    await expect(token.connect(user).mint(user.address, 1n)).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });

  it("không mint vượt cap", async () => {
    await expect(token.connect(minter).mint(user.address, CAP + 1n)).to.be.revertedWithCustomError(token, "ERC20ExceededCap");
    await token.connect(minter).mint(user.address, CAP);
    await expect(token.connect(minter).mint(user.address, 1n)).to.be.revertedWithCustomError(token, "ERC20ExceededCap");
  });

  it("transfer & số dư", async () => {
    await token.connect(minter).mint(user.address, 50n);
    await token.connect(user).transfer(owner.address, 20n);
    expect(await token.balanceOf(user.address)).to.equal(30n);
    expect(await token.balanceOf(owner.address)).to.equal(20n);
    await expect(token.connect(user).transfer(owner.address, 31n)).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
  });

  it("approve + transferFrom", async () => {
    await token.connect(minter).mint(user.address, 50n);
    await token.connect(user).approve(owner.address, 40n);
    await token.transferFrom(user.address, minter.address, 40n);
    expect(await token.balanceOf(minter.address)).to.equal(40n);
    expect(await token.allowance(user.address, owner.address)).to.equal(0n);
  });

  it("burn giảm totalSupply", async () => {
    await token.connect(minter).mint(user.address, 50n);
    await token.connect(user).burn(10n);
    expect(await token.totalSupply()).to.equal(40n);
  });

  it("admin=0 bị từ chối", async () => {
    await expect((await ethers.getContractFactory("RewardToken")).deploy(ethers.ZeroAddress, CAP)).to.be.revertedWith("admin=0");
  });
});
