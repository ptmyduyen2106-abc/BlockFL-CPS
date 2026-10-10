import { formatUnits } from "ethers";

const toBfl = (v) => Number(formatUnits(v ?? 0n, 18));
export const NODE_COLORS = ["var(--color-brand)", "var(--color-pink)", "var(--color-brand-2)", "var(--color-sky)", "var(--color-warn)", "var(--color-sun)"];

/** Suy ra toàn bộ số liệu thưởng từ dữ liệu on-chain đã tải (sự kiện RewardPaid + vòng + node). Không cần đổi contract. */
export function buildRewards(data) {
  const paid = data.events
    .filter((e) => e.name === "RewardPaid")
    .map((e) => ({ round: Number(e.args.roundId), node: e.args.node, amount: e.args.amount, txHash: e.txHash, block: e.block, time: e.time }))
    .sort((a, b) => a.round - b.round || a.block - b.block);

  const done = data.rounds.filter((r) => r.status === 2);
  const nodes = data.nodes.map((n, i) => ({ ...n, color: NODE_COLORS[i % NODE_COLORS.length] }));
  const key = (a) => a.toLowerCase();

  // thưởng theo (vòng, node)
  const byRound = done.map((r) => {
    const sum = {};
    paid.filter((p) => p.round === r.id).forEach((p) => { sum[key(p.node)] = (sum[key(p.node)] ?? 0n) + p.amount; });
    const samples = Object.fromEntries(r.updates.map((u) => [key(u.node), u.numSamples]));
    const paidTotal = Object.values(sum).reduce((a, b) => a + b, 0n);
    return { round: r.id, pool: r.rewardPool, totalSamples: r.totalSamples, sum, samples, paidTotal, dust: r.rewardPool - paidTotal };
  });

  // tổng và tích luỹ theo node
  const perNode = nodes.map((n) => {
    const total = byRound.reduce((a, r) => a + (r.sum[key(n.address)] ?? 0n), 0n);
    let run = 0n;
    const cumulative = byRound.map((r) => { run += r.sum[key(n.address)] ?? 0n; return toBfl(run); });
    return { ...n, total, cumulative, samples: byRound.reduce((a, r) => a + (r.samples[key(n.address)] ?? 0), 0) };
  });

  const totalPaid = paid.reduce((a, p) => a + p.amount, 0n);
  const totalPool = byRound.reduce((a, r) => a + r.pool, 0n);
  return {
    paid, byRound, perNode, nodes, totalPaid, totalPool,
    // đối soát: tổng thưởng theo sự kiện phải khớp tổng cung token (token chỉ được mint qua FLManager)
    reconciled: totalPaid === data.supply,
    toBfl, key,
  };
}
