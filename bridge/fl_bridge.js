// Cầu nối AI ↔ Blockchain: gửi hash(Δw) on-chain sau mỗi round FL (Ethers.js v6)
//
//   node bridge/fl_bridge.js --network localhost --round 1 [--finalize] [--start]
//
// Đọc  ai_model/outputs/round_<n>/round.json  (xem scripts/make_sample_round.js)
// - Mỗi node ký giao dịch bằng khóa riêng của nó (NODE_PRIVATE_KEYS="k0,k1,k2" ; local: dùng account Hardhat #1,#2,#3)
// - hash(Δw) = keccak256(file nhị phân Δw) ; loss/accuracy đổi sang số nguyên (×1e4)
// - Tùy chọn: PINATA_JWT để đẩy Δw lên IPFS và gửi CID on-chain
require("dotenv").config();
const fs = require("fs"), path = require("path");
const { ethers } = require("ethers");

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : (process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? true : process.argv[i + 1]); };
const NETWORK = arg("network", "localhost");
const ROUND = Number(arg("round", 1));
const RPC = { localhost: "http://127.0.0.1:8545", sepolia: process.env.SEPOLIA_RPC_URL }[NETWORK];
const ROOT = path.join(__dirname, "..");

const HARDHAT_KEYS = [ // 4 khóa đầu tiên của `hardhat node` - CHỈ DÙNG LOCAL
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
];

async function pinToIPFS(file) {
  if (!process.env.PINATA_JWT) return "";
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)]), path.basename(file));
  const r = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", { method: "POST", headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` }, body: form });
  if (!r.ok) throw new Error("Pinata: " + r.status);
  return (await r.json()).IpfsHash;
}

async function main() {
  if (!RPC) throw new Error(`Chưa cấu hình RPC cho mạng ${NETWORK}`);
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", `${NETWORK}.json`), "utf8"));
  const abi = JSON.parse(fs.readFileSync(path.join(ROOT, "dashboard/src/contracts/FLManager.abi.json"), "utf8"));

  const isLocal = NETWORK === "localhost";
  const ownerKey = isLocal ? HARDHAT_KEYS[0] : process.env.DEPLOYER_PRIVATE_KEY;
  const nodeKeys = isLocal ? HARDHAT_KEYS.slice(1) : (process.env.NODE_PRIVATE_KEYS || "").split(",").filter(Boolean);
  const owner = new ethers.Wallet(ownerKey, provider);
  const flOwner = new ethers.Contract(dep.contracts.FLManager, abi, owner);

  const dir = path.join(ROOT, "ai_model", "outputs", `round_${ROUND}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "round.json"), "utf8"));

  // 1) mở vòng (nếu yêu cầu)
  if (arg("start", false)) {
    const pool = ethers.parseEther(String(arg("pool", "300")));
    const tx = await flOwner.startRound(pool); await tx.wait();
    console.log(`▶ startRound -> round #${await flOwner.currentRound()} (pool ${ethers.formatEther(pool)} BFL) tx=${tx.hash}`);
  }
  const rid = await flOwner.currentRound();
  console.log(`Vòng hiện tại on-chain: #${rid}`);

  // 2) mỗi node: đăng ký (nếu chưa) + gửi hash(Δw)
  for (const n of manifest.nodes) {
    const key = nodeKeys[n.nodeIndex];
    if (!key) throw new Error(`Thiếu khóa cho nodeIndex=${n.nodeIndex}`);
    const w = new ethers.Wallet(key, provider);
    const fl = new ethers.Contract(dep.contracts.FLManager, abi, w);
    if (!(await fl.getNode(w.address)).registered) {
      await (await fl.registerNode(`edge-node-${n.nodeIndex + 1}`)).wait();
      console.log(`  + đăng ký node ${w.address}`);
    }
    const file = path.join(dir, n.weightsFile);
    const deltaHash = ethers.keccak256(fs.readFileSync(file));
    const cid = await pinToIPFS(file);
    const tx = await fl.submitUpdate(deltaHash, cid, n.numSamples, Math.round(n.loss * 1e4), Math.round(n.accuracy * 1e4));
    const rc = await tx.wait();
    console.log(`  ✔ node${n.nodeIndex + 1} ${w.address.slice(0, 8)}… hash=${deltaHash.slice(0, 12)}… n=${n.numSamples} tx=${rc.hash}`);
  }

  // 3) chốt vòng: FedAvg + global hash + thưởng token
  if (arg("finalize", false)) {
    const tx = await flOwner.finalizeRound(); const rc = await tx.wait();
    const r = await flOwner.getRound(rid);
    console.log(`■ finalizeRound tx=${rc.hash}`);
    console.log(`  globalModelHash=${r.globalModelHash}\n  avgLoss=${Number(r.avgLossE4) / 1e4} avgAcc=${Number(r.avgAccBps) / 100}%`);
  }
}
main().catch((e) => { console.error("✘", e.shortMessage || e.message); process.exit(1); });
