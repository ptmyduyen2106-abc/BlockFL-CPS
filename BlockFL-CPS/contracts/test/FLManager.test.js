const { expect } = require("chai");
const { ethers }  = require("hardhat");

describe("BlockFL Smart Contracts", function () {
  let token, manager, owner, node1, node2, node3;

  beforeEach(async () => {
    [owner, node1, node2, node3] = await ethers.getSigners();

    const RewardToken = await ethers.getContractFactory("RewardToken");
    token = await RewardToken.deploy();

    const FLManager = await ethers.getContractFactory("FLManager");
    manager = await FLManager.deploy(
      await token.getAddress(),
      2,                              // minContributors
      ethers.parseEther("10")         // rewardPerContribution
    );

    await token.transferOwnership(await manager.getAddress());
  });

  it("Owner có thể đăng ký node", async () => {
    await manager.registerNode(node1.address);
    const info = await manager.nodes(node1.address);
    expect(info.registered).to.equal(true);
  });

  it("Node chưa đăng ký không thể submit", async () => {
    const hash = ethers.keccak256(ethers.toUtf8Bytes("weights_round1"));
    await expect(
      manager.connect(node1).submitWeightHash(hash)
    ).to.be.revertedWith("FLManager: node chua dang ky");
  });

  it("Round tự động finalize khi đủ 2 node + mint token thưởng", async () => {
    await manager.registerNode(node1.address);
    await manager.registerNode(node2.address);

    const h1 = ethers.keccak256(ethers.toUtf8Bytes("node1_weights"));
    const h2 = ethers.keccak256(ethers.toUtf8Bytes("node2_weights"));

    await manager.connect(node1).submitWeightHash(h1);
    await manager.connect(node2).submitWeightHash(h2);

    // Round 1 đã finalized → currentRound = 2
    expect(await manager.currentRound()).to.equal(2);

    // Cả 2 node nhận 10 FLT
    const bal1 = await token.balanceOf(node1.address);
    const bal2 = await token.balanceOf(node2.address);
    expect(bal1).to.equal(ethers.parseEther("10"));
    expect(bal2).to.equal(ethers.parseEther("10"));
  });

  it("Không thể submit 2 lần trong cùng 1 round", async () => {
    await manager.registerNode(node1.address);
    const h = ethers.keccak256(ethers.toUtf8Bytes("weights"));
    await manager.connect(node1).submitWeightHash(h);
    await expect(
      manager.connect(node1).submitWeightHash(h)
    ).to.be.revertedWith("FLManager: da gui round nay");
  });
});
