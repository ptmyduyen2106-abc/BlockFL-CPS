"use client";
import { useMemo, useState } from "react";
import useChainData from "@/components/useChainData";
import { AddrLink, Empty, ErrorBox, Spinner, TxLink } from "@/components/ui";
import { blockUrl } from "@/lib/chains";
import { bfl, short, when } from "@/lib/format";

const detail = (e) => {
  const a = e.args;
  switch (e.name) {
    case "UpdateSubmitted": return `hash(Δw)=${short(a.deltaHash, 10, 6)} · n=${a.numSamples} · loss=${(Number(a.lossE4) / 1e4).toFixed(4)} · acc=${(Number(a.accBps) / 100).toFixed(2)}%${a.cid ? ` · CID=${short(a.cid, 8, 4)}` : ""}`;
    case "RoundFinalized": return `global=${short(a.globalModelHash, 10, 6)} · loss=${(Number(a.avgLossE4) / 1e4).toFixed(4)} · acc=${(Number(a.avgAccBps) / 100).toFixed(2)}% · ${a.updateCount} node`;
    case "RewardPaid": return `+${bfl(a.amount)} BFL`;
    case "RoundStarted": return `pool=${bfl(a.rewardPool, 0)} BFL`;
    case "NodeRegistered": return a.metadata;
    default: return "";
  }
};

export default function Transactions() {
  const { data, error, loading, chainId } = useChainData();
  const [filter, setFilter] = useState("all");
  const names = useMemo(() => (data ? [...new Set(data.events.map((e) => e.name))] : []), [data]);
  if (error && !data) return <ErrorBox msg={error} />;
  if (loading || !data) return <Spinner />;
  const rows = data.events.filter((e) => filter === "all" || e.name === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Lịch sử giao dịch on-chain</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="ml-auto rounded-lg border border-line bg-panel px-2 py-1.5 text-xs">
          <option value="all">Tất cả sự kiện</option>
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <p className="text-sm text-mute">Mỗi dòng gắn link Etherscan tới TX hash. Mạng local không có explorer nên chỉ hiện hash.</p>
      <div className="card overflow-x-auto p-4">
        {rows.length === 0 ? <Empty>Không có sự kiện.</Empty> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-mute"><tr><th className="py-1">Sự kiện</th><th>Vòng</th><th>Node</th><th>Chi tiết</th><th>TX hash</th><th>Block</th><th>Thời gian</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={`${e.txHash}-${e.logIndex}`} className="border-t border-line align-top">
                  <td className="py-2 whitespace-nowrap font-medium">{e.label}</td>
                  <td>{e.args.roundId !== undefined ? `#${e.args.roundId}` : "—"}</td>
                  <td>{e.args.node ? <AddrLink chainId={chainId} address={e.args.node} /> : "—"}</td>
                  <td className="mono text-xs text-mute">{detail(e)}</td>
                  <td><TxLink chainId={chainId} hash={e.txHash} /></td>
                  <td className="text-xs">{blockUrl(chainId, e.block) ? <a className="ext" href={blockUrl(chainId, e.block)} target="_blank" rel="noreferrer">{e.block}</a> : e.block}</td>
                  <td className="whitespace-nowrap text-xs text-mute">{when(e.time)}</td>
                </tr>))}
            </tbody>
          </table>)}
      </div>
    </div>
  );
}
