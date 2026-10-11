const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const h = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const MIN = ethers.parseEther("0.001");
const BFL = (n) => ethers.parseEther(String(n));

describe("FLManagerV2 (stake / slash / thưởng theo chất lượng)", () => {
  let owner, n1, n2, n3, n4, outsider, token, fl;

  beforeEach(async () => {
    [owner, n1, n2, n3, n4, outsider] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("RewardToken")).deploy(owner.address, BFL(1_000_000));
    fl = await (await ethers.getContractFactory("FLManagerV2")).deploy(await token.getAddress(), owner.address);
    await token.grantRole(await token.MINTER_ROLE(), await fl.getAddress());
  });

  const join = async (signers, stake = MIN) => { for (const [i, s] of signers.entries()) await fl.connect(s).registerNode(`node-${i + 1}`, { value: stake }); };
  const submit = (s, tag, n, loss, acc) => fl.connect(s).submitUpdate(h(tag), "", n, loss, acc);

  describe("đăng ký & cọc", () => {
    it("phải đặt cọc ≥ minStake; lưu cọc + phát sự kiện", async () => {
      await expect(fl.connect(n1).registerNode("a", { value: MIN - 1n })).to.be.revertedWith("stake too low");
      await expect(fl.connect(n1).registerNode("a")).to.be.revertedWith("stake too low");
      await expect(fl.connect(n1).registerNode("a", { value: MIN })).to.emit(fl, "NodeRegistered").withArgs(n1.address, "a", MIN);
      expect((await fl.getNode(n1.address)).stake).to.equal(MIN);
      expect(await ethers.provider.getBalance(await fl.getAddress())).to.equal(MIN);
      await expect(fl.connect(n1).registerNode("b", { value: MIN })).to.be.revertedWith("already registered");
      await expect(fl.connect(n2).registerNode("x".repeat(129), { value: MIN })).to.be.revertedWith("metadata too long");
    });

    it("topUp: chỉ node đã đăng ký, phải có giá trị", async () => {
      await expect(fl.connect(outsider).topUp({ value: 1n })).to.be.revertedWith("not registered");
      await join([n1]);
      await expect(fl.connect(n1).topUp()).to.be.revertedWith("no value");
      await expect(fl.connect(n1).topUp({ value: 5n })).to.emit(fl, "StakeAdded").withArgs(n1.address, 5n, MIN + 5n);
    });

    it("setParams có giới hạn & chỉ owner", async () => {
      await expect(fl.connect(n1).setParams(MIN, 1000, 20000, 5000, 86400)).to.be.revertedWithCustomError(fl, "OwnableUnauthorizedAccount");
      await expect(fl.setParams(MIN, 10001, 20000, 5000, 86400)).to.be.revertedWith("slash>100%");
      await expect(fl.setParams(MIN, 1000, 9999, 5000, 86400)).to.be.revertedWith("factor<1x");
      await expect(fl.setParams(MIN, 1000, 20000, 0, 86400)).to.be.revertedWith("maxSamples=0");
      await expect(fl.setParams(MIN, 1000, 20000, 5000, 31 * 86400)).to.be.revertedWith("unbonding>30d");
      await expect(fl.setParams(MIN * 2n, 500, 30000, 100, 3600)).to.emit(fl, "ParamsChanged").withArgs(MIN * 2n, 500, 30000, 100, 3600);
      expect(await fl.minStake()).to.equal(MIN * 2n);
    });
  });

  describe("thưởng theo chất lượng", () => {
    beforeEach(async () => { await join([n1, n2, n3]); });

    it("reward_i = pool × (nᵢ × accᵢ) / Σ(nⱼ × accⱼ)", async () => {
      await fl.startRound(BFL(300));
      await submit(n1, "d1", 100, 5000, 6000);
      await submit(n2, "d2", 200, 5000, 8000);
      await submit(n3, "d3", 300, 5000, 9000);
      await fl.finalizeRound();
      const w = [100n * 6000n, 200n * 8000n, 300n * 9000n]; const sum = w[0] + w[1] + w[2];
      for (const [i, s] of [n1, n2, n3].entries()) {
        const exp = (BFL(300) * w[i]) / sum;
        expect(await token.balanceOf(s.address)).to.equal(exp);
        expect((await fl.getNode(s.address)).totalRewards).to.equal(exp);
      }
      const ups = await fl.getRoundUpdates(1);
      expect(ups[2].reward).to.equal((BFL(300) * w[2]) / sum);
      expect(await token.totalSupply()).to.be.lte(BFL(300));
      expect(await token.totalSupply()).to.be.gt(BFL(300) - 10n);            // chỉ mất bụi làm tròn
    });

    it("trần maxSamplesPerRound chặn khai gian số mẫu", async () => {
      await fl.startRound(BFL(300));
      await submit(n1, "d1", 4_000_000, 5000, 8000);   // khai gian: bị cắt còn 5000
      await submit(n2, "d2", 5000, 5000, 8000);
      await submit(n3, "d3", 5000, 5000, 8000);
      await fl.finalizeRound();
      expect(await token.balanceOf(n1.address)).to.equal(await token.balanceOf(n2.address));   // chia đều thay vì ăn gần hết
      expect((await fl.getRound(1)).totalSamples).to.equal(15000n);
    });

    it("accuracy cao hơn → thưởng cao hơn khi cùng số mẫu", async () => {
      await fl.startRound(BFL(90));
      await submit(n1, "d1", 1000, 5000, 5000); await submit(n2, "d2", 1000, 5000, 7500); await submit(n3, "d3", 1000, 5000, 7500);
      await fl.finalizeRound();
      expect(await token.balanceOf(n2.address)).to.be.gt(await token.balanceOf(n1.address));
    });

    it("pool = 0 → không mint", async () => {
      await fl.startRound(0);
      await submit(n1, "a", 10, 100, 100); await submit(n2, "b", 10, 100, 100); await submit(n3, "c", 10, 100, 100);
      await fl.finalizeRound();
      expect(await token.totalSupply()).to.equal(0n);
    });

    it("FedAvg chỉ số có trọng số + globalModelHash tái tạo được", async () => {
      await fl.startRound(0);
      await submit(n1, "d1", 100, 6000, 7000); await submit(n2, "d2", 200, 4500, 8000); await submit(n3, "d3", 300, 3000, 9000);
      await fl.finalizeRound();
      const r = await fl.getRound(1);
      expect(r.avgLossE4).to.equal(4000n); expect(r.avgAccBps).to.equal(8333n); expect(r.flaggedCount).to.equal(0n);
      const exp = ethers.keccak256(ethers.solidityPacked(["bytes32", "uint256", "bytes32", "uint32", "bytes32", "uint32", "bytes32", "uint32"],
        [ethers.ZeroHash, 1, h("d1"), 100, h("d2"), 200, h("d3"), 300]));
      expect(r.globalModelHash).to.equal(exp);
    });
  });

  describe("phạt tự động (outlier)", () => {
    beforeEach(async () => { await join([n1, n2, n3]); });

    it("loss > 2× median → loại khỏi tổng hợp, không thưởng, bị slash 10% cọc", async () => {
      await fl.setMinUpdates(2);
      await fl.startRound(BFL(300));
      await submit(n1, "d1", 100, 3000, 8000);
      await submit(n2, "d2", 100, 3100, 8000);
      await submit(n3, "d3", 100, 9000, 8000);            // median = 3100; 9000 > 6200 → outlier
      const tx = await fl.finalizeRound();
      await expect(tx).to.emit(fl, "NodeFlagged").withArgs(1, n3.address, 9000, 3100);
      await expect(tx).to.emit(fl, "Slashed").withArgs(n3.address, MIN / 10n, 1, ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "bytes32"], [1, h("d3")])));
      const r = await fl.getRound(1);
      expect(r.flaggedCount).to.equal(1n); expect(r.medianLossE4).to.equal(3100n);
      expect(r.avgLossE4).to.equal(3050n);                 // chỉ tính n1, n2
      expect(await token.balanceOf(n3.address)).to.equal(0n);
      expect(await token.balanceOf(n1.address)).to.equal(BFL(150));
      const nd = await fl.getNode(n3.address);
      expect(nd.stake).to.equal(MIN - MIN / 10n); expect(nd.totalSlashed).to.equal(MIN / 10n); expect(nd.flaggedCount).to.equal(1n);
      expect(await fl.slashedPool()).to.equal(MIN / 10n);
      const exp = ethers.keccak256(ethers.solidityPacked(["bytes32", "uint256", "bytes32", "uint32", "bytes32", "uint32"], [ethers.ZeroHash, 1, h("d1"), 100, h("d2"), 100]));
      expect(r.globalModelHash).to.equal(exp);             // hash của n3 không nằm trong cam kết
      expect((await fl.getRoundUpdates(1))[2].flagged).to.equal(true);
    });

    it("ngưỡng biên: loss = đúng 2× median không bị phạt", async () => {
      await fl.startRound(BFL(30));
      await submit(n1, "d1", 100, 3000, 8000); await submit(n2, "d2", 100, 3000, 8000); await submit(n3, "d3", 100, 6000, 8000);
      await fl.finalizeRound();
      expect((await fl.getRound(1)).flaggedCount).to.equal(0n);
    });

    it("sau khi bị slash xuống dưới minStake: node bị khóa tới khi topUp", async () => {
      await fl.setMinUpdates(2);
      await fl.startRound(0);
      await submit(n1, "d1", 100, 3000, 8000); await submit(n2, "d2", 100, 3000, 8000); await submit(n3, "d3", 100, 9000, 8000);
      await fl.finalizeRound();
      expect((await fl.getNode(n3.address)).active).to.equal(false);
      await fl.startRound(0);
      await expect(submit(n3, "e3", 100, 3000, 8000)).to.be.revertedWith("node not allowed");
      await expect(fl.setNodeActive(n3.address, true)).to.be.revertedWith("stake too low");
      await expect(fl.connect(n3).topUp({ value: MIN / 10n })).to.emit(fl, "NodeStatusChanged").withArgs(n3.address, true);
      await submit(n3, "e3", 100, 3000, 8000);              // gửi lại được
    });

    it("không đủ update hợp lệ → finalize revert", async () => {
      await join([n4]);
      await fl.setMinUpdates(4);
      await fl.startRound(0);
      await submit(n1, "a", 10, 1000, 8000); await submit(n2, "b", 10, 1000, 8000); await submit(n3, "c", 10, 1000, 8000); await submit(n4, "d", 10, 9000, 8000);
      await expect(fl.finalizeRound()).to.be.revertedWith("not enough valid updates");
    });

    it("median của số node chẵn", async () => {
      await join([n4]);
      await fl.startRound(0);
      await submit(n1, "a", 10, 1000, 8000); await submit(n2, "b", 10, 2000, 8000); await submit(n3, "c", 10, 3000, 8000); await submit(n4, "d", 10, 4000, 8000);
      await fl.finalizeRound();
      expect((await fl.getRound(1)).medianLossE4).to.equal(2500n);
    });
  });

  describe("phạt thủ công & rút tiền phạt", () => {
    beforeEach(async () => { await join([n1, n2, n3], MIN * 5n); });

    it("chỉ owner slash; bps hợp lệ; trừ cọc và ghi evidence", async () => {
      await expect(fl.connect(n1).slash(n2.address, 1000, h("ev"))).to.be.revertedWithCustomError(fl, "OwnableUnauthorizedAccount");
      await expect(fl.slash(n2.address, 0, h("ev"))).to.be.revertedWith("bad bps");
      await expect(fl.slash(n2.address, 10001, h("ev"))).to.be.revertedWith("bad bps");
      await expect(fl.slash(outsider.address, 1000, h("ev"))).to.be.revertedWith("not registered");
      await expect(fl.slash(n2.address, 2000, h("ev"))).to.emit(fl, "Slashed").withArgs(n2.address, MIN, 2, h("ev"));
      expect((await fl.getNode(n2.address)).stake).to.equal(MIN * 4n);
    });

    it("slash 100% → stake 0 và inactive", async () => {
      await fl.slash(n1.address, 10000, h("bad"));
      const n = await fl.getNode(n1.address);
      expect(n.stake).to.equal(0n); expect(n.active).to.equal(false);
    });

    it("withdrawSlashed: chỉ owner, chuyển đúng số ETH, không rút hai lần", async () => {
      await fl.slash(n1.address, 5000, h("x"));
      const amt = MIN * 5n / 2n;
      expect(await fl.slashedPool()).to.equal(amt);
      await expect(fl.connect(n1).withdrawSlashed(n1.address)).to.be.revertedWithCustomError(fl, "OwnableUnauthorizedAccount");
      await expect(fl.withdrawSlashed(ethers.ZeroAddress)).to.be.revertedWith("to=0");
      await expect(fl.withdrawSlashed(outsider.address)).to.changeEtherBalance(outsider, amt);
      await expect(fl.withdrawSlashed(outsider.address)).to.be.revertedWith("nothing");
    });
  });

  describe("rút cọc (unbonding)", () => {
    beforeEach(async () => { await join([n1, n2, n3]); });

    it("requestExit → chờ unbonding → withdrawStake", async () => {
      await expect(fl.connect(n1).withdrawStake()).to.be.revertedWith("exit not requested");
      await fl.connect(n1).requestExit();
      await expect(fl.connect(n1).requestExit()).to.be.revertedWith("cannot exit");
      expect((await fl.getNode(n1.address)).active).to.equal(false);
      await expect(fl.connect(n1).withdrawStake()).to.be.revertedWith("unbonding");
      await time.increase(86400 + 1);
      await expect(fl.connect(n1).withdrawStake()).to.changeEtherBalance(n1, MIN);
      await expect(fl.connect(n1).withdrawStake()).to.be.revertedWith("exit not requested");
      expect((await fl.getNode(n1.address)).stake).to.equal(0n);
    });

    it("không thoát được khi đã gửi update trong vòng đang mở; thoát được sau khi chốt", async () => {
      await fl.startRound(0);
      await submit(n1, "a", 10, 100, 100); await submit(n2, "b", 10, 100, 100); await submit(n3, "c", 10, 100, 100);
      await expect(fl.connect(n1).requestExit()).to.be.revertedWith("update pending in open round");
      await fl.finalizeRound();
      await fl.connect(n1).requestExit();
    });

    it("cọc vẫn bị slash được trong lúc unbonding", async () => {
      await fl.connect(n1).requestExit();
      await fl.slash(n1.address, 5000, h("late"));
      await time.increase(86400 + 1);
      await expect(fl.connect(n1).withdrawStake()).to.changeEtherBalance(n1, MIN / 2n);
    });

    it("topUp khi đang thoát không kích hoạt lại", async () => {
      await fl.connect(n1).requestExit();
      await fl.connect(n1).topUp({ value: MIN });
      expect((await fl.getNode(n1.address)).active).to.equal(false);
      await expect(fl.setNodeActive(n1.address, true)).to.be.revertedWith("stake too low");
    });

    it("chống reentrancy: node độc hại chỉ rút được một lần", async () => {
      const atk = await (await ethers.getContractFactory("ReentrantNode")).deploy(await fl.getAddress());
      await atk.join({ value: MIN * 2n });
      await atk.exit();
      await time.increase(86400 + 1);
      await expect(atk.pull()).to.changeEtherBalance(atk, MIN * 2n);
      expect(await atk.reentries()).to.equal(1n);
      expect(await atk.reentrySucceeded()).to.equal(false);
      expect((await fl.getNode(await atk.getAddress())).stake).to.equal(0n);
    });
  });

  describe("kiểm tra đầu vào & oracle", () => {
    beforeEach(async () => { await join([n1, n2, n3]); });

    it("giữ các ràng buộc của V1", async () => {
      await expect(submit(n1, "a", 1, 1, 1)).to.be.revertedWith("no open round");
      await fl.startRound(0);
      await expect(fl.startRound(0)).to.be.revertedWith("previous round open");
      await expect(fl.connect(n1).submitUpdate(ethers.ZeroHash, "", 1, 1, 1)).to.be.revertedWith("empty hash");
      await expect(submit(n1, "a", 0, 1, 1)).to.be.revertedWith("no samples");
      await expect(submit(n1, "a", 1, 1, 10001)).to.be.revertedWith("acc>100%");
      await expect(submit(outsider, "a", 1, 1, 1)).to.be.revertedWith("node not allowed");
      await submit(n1, "a", 1, 1, 1);
      await expect(submit(n1, "a2", 1, 1, 1)).to.be.revertedWith("already submitted");
      await expect(fl.finalizeRound()).to.be.revertedWith("not enough updates");
      await expect(fl.connect(n1).finalizeRound()).to.be.revertedWithCustomError(fl, "OwnableUnauthorizedAccount");
    });

    it("cổng oracle Chainlink hoạt động như V1", async () => {
      const link = await (await ethers.getContractFactory("MockLink")).deploy();
      const op = await (await ethers.getContractFactory("MockOperator")).deploy();
      const oracle = await (await ethers.getContractFactory("SensorOracle")).deploy(await link.getAddress(), await op.getAddress(), ethers.encodeBytes32String("job"), 1n);
      await fl.setSensorOracle(await oracle.getAddress());
      await fl.startRound(0);
      await expect(submit(n1, "a", 1, 1, 1)).to.be.revertedWith("sensor data not verified");
      await oracle.setManualVerification(n1.address, 1, true);
      await submit(n1, "a", 1, 1, 1);
    });

    it("setMinUpdates / setNodeActive chỉ owner", async () => {
      await expect(fl.connect(n1).setMinUpdates(1)).to.be.revertedWithCustomError(fl, "OwnableUnauthorizedAccount");
      await expect(fl.setMinUpdates(0)).to.be.revertedWith("bad min");
      await fl.setNodeActive(n1.address, false);
      expect((await fl.getNode(n1.address)).active).to.equal(false);
      await expect(fl.setNodeActive(outsider.address, true)).to.be.revertedWith("not registered");
    });
  });
});
