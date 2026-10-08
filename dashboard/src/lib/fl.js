import { Contract, JsonRpcProvider } from "ethers";
import FLABI from "@/contracts/FLManager.abi.json";
import TokenABI from "@/contracts/RewardToken.abi.json";
import { CHAINS, deploymentOf } from "./chains";

const providers = {};
export const readProvider = (chainId) =>
  (providers[chainId] ??= new JsonRpcProvider(CHAINS[chainId].rpc, chainId, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 }));

export const flContract = (chainId, runner) => new Contract(deploymentOf(chainId).FLManager, FLABI, runner ?? readProvider(chainId));
export const tokenContract = (chainId, runner) => new Contract(deploymentOf(chainId).RewardToken, TokenABI, runner ?? readProvider(chainId));

const EVENT_LABEL = {
  NodeRegistered: "Đăng ký node", RoundStarted: "Mở vòng FL", UpdateSubmitted: "Gửi hash(Δw)",
  RoundFinalized: "Chốt vòng (FedAvg)", RewardPaid: "Trả thưởng BFL", NodeStatusChanged: "Đổi trạng thái node",
  OracleChanged: "Đổi oracle", MinUpdatesChanged: "Đổi minUpdates",
};

/** Tải toàn bộ trạng thái FL + lịch sử sự kiện từ chuỗi */
export async function loadChainData(chainId) {
  const dep = deploymentOf(chainId);
  if (!dep) throw new Error(`Chưa có địa chỉ contract cho chain ${chainId}. Chạy: npx hardhat run scripts/deploy.js --network ...`);
  const provider = readProvider(chainId);
  const fl = flContract(chainId);
  const token = tokenContract(chainId);

  const [currentRound, nodeAddrs, latestGlobalHash, minUpdates, supply, oracle] = await Promise.all([
    fl.currentRound(), fl.getNodeList(), fl.latestGlobalHash(), fl.minUpdates(), token.totalSupply(), fl.sensorOracle(),
  ]);

  const rounds = [];
  for (let i = 1; i <= Number(currentRound); i++) {
    const [r, ups] = await Promise.all([fl.getRound(i), fl.getRoundUpdates(i)]);
    rounds.push({
      id: i, status: Number(r.status), startedAt: Number(r.startedAt), finalizedAt: Number(r.finalizedAt),
      updateCount: Number(r.updateCount), totalSamples: Number(r.totalSamples), rewardPool: r.rewardPool,
      globalModelHash: r.globalModelHash, avgLoss: Number(r.avgLossE4) / 1e4, avgAcc: Number(r.avgAccBps) / 100,
      updates: ups.map((u) => ({ node: u.node, deltaHash: u.deltaHash, cid: u.cid, numSamples: Number(u.numSamples), loss: Number(u.lossE4) / 1e4, acc: Number(u.accBps) / 100, timestamp: Number(u.timestamp) })),
    });
  }

  const nodes = await Promise.all(nodeAddrs.map(async (a) => {
    const [n, bal] = await Promise.all([fl.getNode(a), token.balanceOf(a)]);
    return { address: a, metadata: n.metadata, active: n.active, registeredAt: Number(n.registeredAt), totalUpdates: Number(n.totalUpdates), totalRewards: n.totalRewards, balance: bal };
  }));

  // sự kiện on-chain (cho bảng lịch sử giao dịch + link Etherscan)
  const logs = await fl.queryFilter("*", dep.deployBlock ?? 0, "latest");
  const blockTimes = {};
  await Promise.all([...new Set(logs.map((l) => l.blockNumber))].map(async (b) => { blockTimes[b] = (await provider.getBlock(b)).timestamp; }));
  const events = logs.filter((l) => l.fragment).map((l) => ({
    name: l.fragment.name, label: EVENT_LABEL[l.fragment.name] || l.fragment.name,
    txHash: l.transactionHash, block: l.blockNumber, logIndex: l.index, time: blockTimes[l.blockNumber],
    args: Object.fromEntries(l.fragment.inputs.map((inp, i) => [inp.name, typeof l.args[i] === "bigint" ? l.args[i] : l.args[i]])),
  })).sort((a, b) => b.block - a.block || b.logIndex - a.logIndex);

  return { currentRound: Number(currentRound), latestGlobalHash, minUpdates: Number(minUpdates), supply, oracle, rounds, nodes, events, fetchedAt: Date.now() };
}
