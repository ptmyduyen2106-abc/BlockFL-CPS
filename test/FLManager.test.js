const { expect } = require("chai");
const { ethers } = require("hardhat");

const h = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

describe("FLManager", () => {
  let owner, n1, n2, n3, outsider, token, fl;
  const POOL = ethers.parseEther("300");

  beforeEach(async () => {
    [owner, n1, n2, n3, outsider] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("RewardToken")).deploy(owner.address, ethers.parseEther("1000000"));
    fl = await (await ethers.getContractFactory("FLManager")).deploy(await token.getAddress(), owner.address);
    await token.grantRole(await token.MINTER_ROLE(), await fl.getAddress());
  });

  const registerAll = async () => {
    await fl.connect(n1).registerNode("ESP32-01|BME280");
    await fl.connect(n2).registerNode("ESP32-02|MQ135");
    await fl.connect(n3).registerNode("RPi5-edge");
  };

  describe("đăng ký node", () => {
    it("đăng ký thành công + phát sự kiện", async () => {
      await expect(fl.connect(n1).registerNode("ESP32-01")).to.emit(fl, "NodeRegistered").withArgs(n1.address, "ESP32-01");
      const n = await fl.getNode(n1.address);
      expect(n.registered).to.equal(true);
      expect(n.active).to.equal(true);
      expect(await fl.nodeCount()).to.equal(1n);
    });
    it("không đăng ký 2 lần / metadata quá dài", async () => {
      await fl.connect(n1).registerNode("a");
      await expect(fl.connect(n1).registerNode("b")).to.be.revertedWith("already registered");
      await expect(fl.connect(n2).registerNode("x".repeat(129))).to.be.revertedWith("metadata too long");
    });
    it("owner khóa/mở node", async () => {
      await fl.connect(n1).registerNode("a");
      await expect(fl.setNodeActive(n1.address, false)).to.emit(fl, "NodeStatusChanged").withArgs(n1.address, false);
      await expect(fl.connect(n1).setNodeActive(n1.address, true)).to.be.revertedWithCustomError(fl, "OwnableUnauthorizedAccount");
      await expect(fl.setNodeActive(outsider.address, true)).to.be.revertedWith("not registered");
    });
  });

  describe("vòng FL", () => {
    beforeEach(registerAll);

    it("chỉ owner startRound; không mở vòng mới khi vòng cũ chưa chốt", async () => {
      await expect(fl.connect(n1).startRound(POOL)).to.be.revertedWithCustomError(fl, "OwnableUnauthorizedAccount");
      await expect(fl.startRound(POOL)).to.emit(fl, "RoundStarted");
      expect(await fl.currentRound()).to.equal(1n);
      await expect(fl.startRound(POOL)).to.be.revertedWith("previous round open");
    });

    it("submitUpdate: lưu hash, phát sự kiện, chặn trùng & node lạ", async () => {
      await fl.startRound(POOL);
      await expect(fl.connect(n1).submitUpdate(h("dw1"), "bafy1", 100, 5000, 8000))
        .to.emit(fl, "UpdateSubmitted").withArgs(1, n1.address, h("dw1"), "bafy1", 100, 5000, 8000);
      await expect(fl.connect(n1).submitUpdate(h("dw1b"), "", 100, 5000, 8000)).to.be.revertedWith("already submitted");
      await expect(fl.connect(outsider).submitUpdate(h("x"), "", 1, 1, 1)).to.be.revertedWith("node not allowed");
      const ups = await fl.getRoundUpdates(1);
      expect(ups.length).to.equal(1);
      expect(ups[0].deltaHash).to.equal(h("dw1"));
    });

    it("submitUpdate: kiểm tra đầu vào", async () => {
      await expect(fl.connect(n1).submitUpdate(h("a"), "", 1, 1, 1)).to.be.revertedWith("no open round");
      await fl.startRound(POOL);
      await expect(fl.connect(n1).submitUpdate(ethers.ZeroHash, "", 1, 1, 1)).to.be.revertedWith("empty hash");
      await expect(fl.connect(n1).submitUpdate(h("a"), "", 0, 1, 1)).to.be.revertedWith("no samples");
      await expect(fl.connect(n1).submitUpdate(h("a"), "", 1, 1, 10001)).to.be.revertedWith("acc>100%");
    });

    it("node bị khóa không gửi được", async () => {
      await fl.startRound(POOL);
      await fl.setNodeActive(n1.address, false);
      await expect(fl.connect(n1).submitUpdate(h("a"), "", 1, 1, 1)).to.be.revertedWith("node not allowed");
    });

    it("finalizeRound cần ≥ minUpdates (3) cập nhật", async () => {
      await fl.startRound(POOL);
      await fl.connect(n1).submitUpdate(h("a"), "", 100, 5000, 8000);
      await fl.connect(n2).submitUpdate(h("b"), "", 100, 5000, 8000);
      await expect(fl.finalizeRound()).to.be.revertedWith("not enough updates");
      await fl.setMinUpdates(2);
      await expect(fl.finalizeRound()).to.emit(fl, "RoundFinalized");
    });

    it("FedAvg có trọng số + chia thưởng theo số mẫu + mint token", async () => {
      await fl.startRound(POOL);
      // n = 100, 200, 300 → N = 600
      await fl.connect(n1).submitUpdate(h("d1"), "", 100, 6000, 7000);
      await fl.connect(n2).submitUpdate(h("d2"), "", 200, 4500, 8000);
      await fl.connect(n3).submitUpdate(h("d3"), "cid3", 300, 3000, 9000);

      // avgLoss = (100*6000 + 200*4500 + 300*3000)/600 = 2400000/600 = 4000
      // avgAcc  = (100*7000 + 200*8000 + 300*9000)/600 = 5000000/600 = 8333 (floor)
      const tx = await fl.finalizeRound();
      await expect(tx).to.emit(fl, "RoundFinalized");
      const r = await fl.getRound(1);
      expect(r.status).to.equal(2n); // Finalized
      expect(r.avgLossE4).to.equal(4000n);
      expect(r.avgAccBps).to.equal(8333n);
      expect(r.updateCount).to.equal(3n);
      expect(r.totalSamples).to.equal(600n);
      expect(r.globalModelHash).to.not.equal(ethers.ZeroHash);
      expect(await fl.latestGlobalHash()).to.equal(r.globalModelHash);

      // thưởng: 300 BFL * n_i / 600  → 50, 100, 150 BFL
      expect(await token.balanceOf(n1.address)).to.equal(ethers.parseEther("50"));
      expect(await token.balanceOf(n2.address)).to.equal(ethers.parseEther("100"));
      expect(await token.balanceOf(n3.address)).to.equal(ethers.parseEther("150"));
      expect(await token.totalSupply()).to.equal(POOL);
      expect((await fl.getNode(n3.address)).totalRewards).to.equal(ethers.parseEther("150"));
      await expect(tx).to.emit(fl, "RewardPaid").withArgs(1, n3.address, ethers.parseEther("150"));
    });

    it("globalModelHash tái tạo được off-chain & nối chuỗi giữa các vòng", async () => {
      await fl.startRound(0);
      await fl.connect(n1).submitUpdate(h("d1"), "", 10, 100, 100);
      await fl.connect(n2).submitUpdate(h("d2"), "", 20, 100, 100);
      await fl.connect(n3).submitUpdate(h("d3"), "", 30, 100, 100);
      await fl.finalizeRound();
      const g1 = (await fl.getRound(1)).globalModelHash;
      const expected = ethers.keccak256(ethers.solidityPacked(
        ["bytes32", "uint256", "bytes32", "uint32", "bytes32", "uint32", "bytes32", "uint32"],
        [ethers.ZeroHash, 1, h("d1"), 10, h("d2"), 20, h("d3"), 30]));
      expect(g1).to.equal(expected);

      await fl.startRound(0);
      await fl.connect(n1).submitUpdate(h("e1"), "", 10, 100, 100);
      await fl.connect(n2).submitUpdate(h("e2"), "", 20, 100, 100);
      await fl.connect(n3).submitUpdate(h("e3"), "", 30, 100, 100);
      await fl.finalizeRound();
      const g2 = (await fl.getRound(2)).globalModelHash;
      expect(g2).to.not.equal(g1);
      const expected2 = ethers.keccak256(ethers.solidityPacked(
        ["bytes32", "uint256", "bytes32", "uint32", "bytes32", "uint32", "bytes32", "uint32"],
        [g1, 2, h("e1"), 10, h("e2"), 20, h("e3"), 30]));
      expect(g2).to.equal(expected2);
    });

    it("chỉ owner finalize; không finalize hai lần", async () => {
      await fl.startRound(0);
      await fl.connect(n1).submitUpdate(h("a"), "", 1, 1, 1);
      await fl.connect(n2).submitUpdate(h("b"), "", 1, 1, 1);
      await fl.connect(n3).submitUpdate(h("c"), "", 1, 1, 1);
      await expect(fl.connect(n1).finalizeRound()).to.be.revertedWithCustomError(fl, "OwnableUnauthorizedAccount");
      await fl.finalizeRound();
      await expect(fl.finalizeRound()).to.be.revertedWith("no open round");
      await expect(fl.connect(n1).submitUpdate(h("z"), "", 1, 1, 1)).to.be.revertedWith("no open round");
    });
  });
});
