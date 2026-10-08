const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Vi Deployer:", deployer.address);
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("So du:", hre.ethers.formatEther(bal), "ETH");

  // 3 Private keys cua 3 node
  const keys = [
    "0xd115f4972a2e4773958e3b387ebc1b9ed44dd66733ffa7f4f50d217f3acbb3af",
    "0x85d44c5833388b37cb54213a38bcf5423f8a46369de11ac5198cb09d40a502a1",
    "0xa98d3e6a97b9dd5250ea6f1313fbfd66b0faa476aa82697998a67ccace5dde96"
  ];

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