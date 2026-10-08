const { expect } = require("chai");
const { ethers } = require("hardhat");

const h = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

describe("SensorOracle (Chainlink) + FLManager gating", () => {
  let owner, n1, n2, n3, link, operator, oracle, token, fl;
  const JOB = ethers.encodeBytes32String("job-http-get");
  const FEE = ethers.parseEther("0.1");

  beforeEach(async () => {
    [owner, n1, n2, n3] = await ethers.getSigners();
    link = await (await ethers.getContractFactory("MockLink")).deploy();
    operator = await (await ethers.getContractFactory("MockOperator")).deploy();
    oracle = await (await ethers.getContractFactory("SensorOracle")).deploy(await link.getAddress(), await operator.getAddress(), JOB, FEE);
    await link.transfer(await oracle.getAddress(), ethers.parseEther("10"));

    token = await (await ethers.getContractFactory("RewardToken")).deploy(owner.address, ethers.parseEther("1000000"));
    fl = await (await ethers.getContractFactory("FLManager")).deploy(await token.getAddress(), owner.address);
    await token.grantRole(await token.MINTER_ROLE(), await fl.getAddress());
    await fl.setSensorOracle(await oracle.getAddress());
    for (const [n, m] of [[n1, "a"], [n2, "b"], [n3, "c"]]) await fl.connect(n).registerNode(m);
    await fl.startRound(0);
  });

  it("node chưa được xác thực → submitUpdate bị từ chối", async () => {
    await expect(fl.connect(n1).submitUpdate(h("a"), "", 1, 1, 1)).to.be.revertedWith("sensor data not verified");
  });

  it("luồng Chainlink: request → operator fulfill(1) → node được phép gửi", async () => {
    const url = "http://rpi5.local:8000/verify/n1/1";
    await expect(oracle.requestVerification(n1.address, 1, url)).to.emit(oracle, "VerificationRequested");
    const reqId = await operator.lastRequestId();
    expect((await oracle.pending(reqId)).node).to.equal(n1.address);
    expect(await link.balanceOf(await operator.getAddress())).to.equal(FEE);

    await expect(operator.fulfill(reqId, 1)).to.emit(oracle, "VerificationFulfilled").withArgs(reqId, n1.address, 1, true);
    expect(await oracle.isVerified(n1.address, 1)).to.equal(true);
    await expect(fl.connect(n1).submitUpdate(h("a"), "", 1, 1, 1)).to.emit(fl, "UpdateSubmitted");
  });

  it("oracle trả 0 → vẫn bị từ chối", async () => {
    await oracle.requestVerification(n2.address, 1, "http://x/y");
    await operator.fulfill(await operator.lastRequestId(), 0);
    expect(await oracle.isVerified(n2.address, 1)).to.equal(false);
    await expect(fl.connect(n2).submitUpdate(h("b"), "", 1, 1, 1)).to.be.revertedWith("sensor data not verified");
  });

  it("chỉ operator mới fulfill được; request ID lạ bị chặn; chỉ owner request", async () => {
    await expect(oracle.connect(n1).fulfill(h("fake"), 1)).to.be.reverted;
    await expect(oracle.connect(n1).requestVerification(n1.address, 1, "u")).to.be.reverted;
  });

  it("phương án dự phòng: manual verification (owner)", async () => {
    await expect(oracle.setManualVerification(n3.address, 1, true)).to.emit(oracle, "ManualVerification");
    await fl.connect(n3).submitUpdate(h("c"), "", 1, 1, 1);
    await expect(oracle.connect(n1).setManualVerification(n1.address, 1, true)).to.be.reverted;
  });

  it("tắt oracle (address 0) → không bắt buộc xác thực", async () => {
    await fl.setSensorOracle(ethers.ZeroAddress);
    await expect(fl.connect(n1).submitUpdate(h("a"), "", 1, 1, 1)).to.emit(fl, "UpdateSubmitted");
  });
});
