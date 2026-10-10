const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Vi Deployer:", deployer.address);
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("So du:", hre.ethers.formatEther(bal), "ETH");

  // Khoa cua cac node doc tu .env (NODE_PRIVATE_KEYS=k0,k1,k2) — KHONG ghi khoa vao ma nguon
  const keys = (process.env.NODE_PRIVATE_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) throw new Error("Thieu NODE_PRIVATE_KEYS trong .env");

  const provider = hre.ethers.provider;

  for (let i = 0; i < keys.length; i++) {
    const nodeWallet = new hre.ethers.Wallet(keys[i], provider);
    const nodeAddr = nodeWallet.address;
    console.log(`Dang chuyen 0.008 ETH cho Node ${i + 1} (${nodeAddr})...`);

    const tx = await deployer.sendTransaction({
      to: nodeAddr,
      value: hre.ethers.parseEther("0.008"),
    });
    await tx.wait(1);
    console.log(`✔ Hoan tat Node ${i + 1}: ${tx.hash}`);
  }

  console.log("\n>>> Da nap Sepolia ETH thanh cong cho ca 3 node!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});