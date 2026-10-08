// Dữ liệu MÔ PHỎNG cho demo/dự phòng (bật bằng NEXT_PUBLIC_USE_MOCK=1). Không phải dữ liệu on-chain thật.
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "1";

const E18 = 10n ** 18n;
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const hex = (n) => "0x" + Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");

const NODES = [
  { address: "0x678557b30dba893466371B90BC5759b9A4AE5f55", metadata: "ESP32-01 | BME280", n: 520 },
  { address: "0x95f1Cc114D599bB14254Ac0d368d01CF21ade12a", metadata: "ESP32-02 | MQ135", n: 640 },
  { address: "0xc7c4EdBd3ABb2853e0b86A7ccd516f22E839489c", metadata: "RPi5-Edge | FedAvg", n: 480 },
];
const LOSS = [0.8120, 0.6934, 0.5625, 0.4781, 0.4120, 0.3655];
const ACC = [58.4, 66.1, 72.35, 77.9, 82.6, 85.7];
const DONE = LOSS.length;
const POOL = 300n * E18;

export function mockChainData() {
  seed = 7;
  const now = Math.floor(Date.now() / 1000), t0 = now - 7 * 3600;
  const events = [], rounds = [];
  let blk = 7000000, tx = () => hex(64);
  const ev = (name, label, time, args) => events.push({ name, label, txHash: tx(), block: blk += 3, logIndex: 0, time, args });

  NODES.forEach((nd, i) => ev("NodeRegistered", "Đăng ký node", t0 + i * 60, { node: nd.address, metadata: nd.metadata }));
  const total = NODES.reduce((a, x) => a + x.n, 0);
  const earned = NODES.map(() => 0n);
  let prev = "0x" + "0".repeat(64), latest = prev;

  for (let r = 1; r <= DONE + 1; r++) {
    const start = t0 + 600 + (r - 1) * 3000, fin = r <= DONE;
    const k = fin ? 3 : 2;
    ev("RoundStarted", "Mở vòng FL", start, { roundId: BigInt(r), rewardPool: POOL });
    const updates = NODES.slice(0, k).map((nd, i) => {
      const loss = LOSS[Math.min(r, DONE) - 1] + (i - 1) * 0.012, acc = ACC[Math.min(r, DONE) - 1] + (1 - i) * 0.8;
      const u = { node: nd.address, deltaHash: hex(64), cid: "", numSamples: nd.n, loss, acc, timestamp: start + 120 * (i + 1) };
      ev("UpdateSubmitted", "Gửi hash(Δw)", u.timestamp, { roundId: BigInt(r), node: nd.address, deltaHash: u.deltaHash, numSamples: BigInt(nd.n), lossE4: BigInt(Math.round(loss * 1e4)), accBps: BigInt(Math.round(acc * 100)), cid: "" });
      return u;
    });
    const samples = updates.reduce((a, x) => a + x.numSamples, 0);
    const gh = fin ? hex(64) : "0x" + "0".repeat(64);
    if (fin) {
      ev("RoundFinalized", "Chốt vòng (FedAvg)", fin ? start + 900 : 0, { roundId: BigInt(r), globalModelHash: gh, avgLossE4: BigInt(Math.round(LOSS[r - 1] * 1e4)), avgAccBps: BigInt(Math.round(ACC[r - 1] * 100)), updateCount: BigInt(k) });
      updates.forEach((u, i) => { const amt = (POOL * BigInt(u.numSamples)) / BigInt(samples); earned[i] += amt; ev("RewardPaid", "Trả thưởng BFL", start + 901, { roundId: BigInt(r), node: u.node, amount: amt }); });
      latest = gh;
    }
    rounds.push({ id: r, status: fin ? 2 : 1, startedAt: start, finalizedAt: fin ? start + 900 : 0, updateCount: k, totalSamples: samples, rewardPool: POOL, globalModelHash: gh, avgLoss: fin ? LOSS[r - 1] : 0, avgAcc: fin ? ACC[r - 1] : 0, updates });
  }
  const nodes = NODES.map((nd, i) => ({ address: nd.address, metadata: nd.metadata, active: true, registeredAt: t0 + i * 60, totalUpdates: DONE + (i < 2 ? 1 : 0), totalRewards: earned[i], balance: earned[i] }));
  events.sort((a, b) => b.block - a.block);
  return { currentRound: DONE + 1, latestGlobalHash: latest, minUpdates: 3, supply: earned.reduce((a, b) => a + b, 0n), oracle: "0x" + "0".repeat(40), rounds, nodes, events, fetchedAt: Date.now() };
}
