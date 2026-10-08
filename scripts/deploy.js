// Deploy RewardToken + FLManager (+ SensorOracle nếu có biến môi trường Chainlink)
//   npx hardhat run scripts/deploy.js --network localhost
//   npx hardhat run scripts/deploy.js --network sepolia
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const { ethers, network, artifacts } = hre;
  const [deployer] = await ethers.getSigners();
  console.log(`Network: ${network.name} | Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  const out = { network: network.name, chainId: Number((await ethers.provider.getNetwork()).chainId), deployer: deployer.address, contracts: {}, txs: {} };

  const Token = await ethers.getContractFactory("RewardToken");
  const token = await Token.deploy(deployer.address, ethers.parseEther("100000000"));
  await token.waitForDeployment();
  out.contracts.RewardToken = await token.getAddress();
  out.txs.RewardToken = token.deploymentTransaction().hash;
  console.log("RewardToken :", out.contracts.RewardToken);

  const FL = await ethers.getContractFactory("FLManager");
  const fl = await FL.deploy(out.contracts.RewardToken, deployer.address);
  await fl.waitForDeployment();
  out.contracts.FLManager = await fl.getAddress();
  out.txs.FLManager = fl.deploymentTransaction().hash;
  out.deployBlock = (await fl.deploymentTransaction().wait()).blockNumber;
  console.log("FLManager   :", out.contracts.FLManager);

  await (await token.grantRole(await token.MINTER_ROLE(), out.contracts.FLManager)).wait();
  console.log("Đã cấp MINTER_ROLE cho FLManager");

  // ---- Chainlink Oracle (tùy chọn) ----
  const { LINK_TOKEN, CHAINLINK_OPERATOR, CHAINLINK_JOB_ID } = process.env;
  if (LINK_TOKEN && CHAINLINK_OPERATOR && CHAINLINK_JOB_ID) {
    const Oracle = await ethers.getContractFactory("SensorOracle");
    const jid = /^0x[0-9a-fA-F]{64}$/.test(CHAINLINK_JOB_ID) ? CHAINLINK_JOB_ID : ethers.zeroPadBytes(ethers.toUtf8Bytes(CHAINLINK_JOB_ID), 32); // UUID 32 ký tự (bỏ dấu '-') hoặc bytes32 hex
    const oracle = await Oracle.deploy(LINK_TOKEN, CHAINLINK_OPERATOR, jid, ethers.parseEther(process.env.CHAINLINK_FEE || "0.1"));
    await oracle.waitForDeployment();
    out.contracts.SensorOracle = await oracle.getAddress();
    out.txs.SensorOracle = oracle.deploymentTransaction().hash;
    console.log("SensorOracle:", out.contracts.SensorOracle);
    if (process.env.ENABLE_ORACLE_GATE === "1") {
      await (await fl.setSensorOracle(out.contracts.SensorOracle)).wait();
      console.log("Đã bật cổng xác thực oracle trong FLManager");
    }
  } else {
    console.log("(Bỏ qua SensorOracle - chưa đặt LINK_TOKEN / CHAINLINK_OPERATOR / CHAINLINK_JOB_ID)");
  }

  // ---- Lưu địa chỉ + ABI cho bridge & dashboard ----
  if (network.name === "hardhat") { console.log("\n(Mạng hardhat in-process là tạm thời - không ghi deployments/*. Dùng --network localhost hoặc sepolia.)"); return; }
  const dDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dDir, { recursive: true });
  fs.writeFileSync(path.join(dDir, `${network.name}.json`), JSON.stringify(out, null, 2));

  const abiDir = path.join(__dirname, "..", "dashboard", "src", "contracts");
  fs.mkdirSync(abiDir, { recursive: true });
  for (const name of ["RewardToken", "FLManager", "SensorOracle"]) {
    const a = await artifacts.readArtifact(name);
    fs.writeFileSync(path.join(abiDir, `${name}.abi.json`), JSON.stringify(a.abi, null, 2));
  }
  const addrFile = path.join(abiDir, "addresses.json");
  const all = fs.existsSync(addrFile) ? JSON.parse(fs.readFileSync(addrFile, "utf8")) : {};
  all[out.chainId] = { ...out.contracts, deployBlock: out.deployBlock };
  fs.writeFileSync(addrFile, JSON.stringify(all, null, 2));
  console.log(`\nĐã lưu deployments/${network.name}.json và dashboard/src/contracts/*`);

  // ---- Xác minh trên Etherscan (chỉ mạng thật) ----
  if (network.name === "sepolia" && process.env.ETHERSCAN_API_KEY) {
    console.log("Chờ 5 block rồi verify trên Etherscan...");
    await token.deploymentTransaction().wait(5);
    const jobs = [
      ["RewardToken", out.contracts.RewardToken, [deployer.address, ethers.parseEther("100000000").toString()]],
      ["FLManager", out.contracts.FLManager, [out.contracts.RewardToken, deployer.address]],
    ];
    for (const [n, address, constructorArguments] of jobs) {
      try { await hre.run("verify:verify", { address, constructorArguments }); console.log("✔ verified", n); }
      catch (e) { console.log(`✘ verify ${n}:`, e.message.split("\n")[0]); }
    }
    console.log(`Xem: https://sepolia.etherscan.io/address/${out.contracts.FLManager}#code`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
