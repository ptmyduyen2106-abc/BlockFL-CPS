const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // 1. Deploy RewardToken
  const RewardToken = await hre.ethers.getContractFactory("RewardToken");
  const token = await RewardToken.deploy();
  await token.waitForDeployment();
  console.log("RewardToken deployed to:", await token.getAddress());

  // 2. Deploy FLManager
  const MIN_CONTRIBUTORS    = 2;                        // tối thiểu 2 node/round
  const REWARD_PER_ROUND    = hre.ethers.parseEther("10"); // 10 FLT/round

  const FLManager = await hre.ethers.getContractFactory("FLManager");
  const manager = await FLManager.deploy(
    await token.getAddress(),
    MIN_CONTRIBUTORS,
    REWARD_PER_ROUND
  );
  await manager.waitForDeployment();
  console.log("FLManager deployed to:", await manager.getAddress());

  // 3. Transfer ownership của RewardToken sang FLManager
  await token.transferOwnership(await manager.getAddress());
  console.log("RewardToken ownership transferred to FLManager");

  console.log("\n✅ Deploy thành công!");
  console.log("Thêm vào .env.local (frontend):");
  console.log(`NEXT_PUBLIC_TOKEN_ADDRESS=${await token.getAddress()}`);
  console.log(`NEXT_PUBLIC_CONTRACT_ADDRESS=${await manager.getAddress()}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
