"use client";
import useChainData from "@/components/useChainData";
import { useWallet } from "@/components/WalletProvider";
import { AddrLink, ChainStrip, Empty, ErrorBox, LineChart, Spinner, Stat, TxLink } from "@/components/ui";
import { bfl, short, when } from "@/lib/format";
import { CHAINS } from "@/lib/chains";

const STATUS = ["—", "Đang mở", "Đã chốt"];

export default function Dashboard() {
  const { data, error, loading, chainId } = useChainData();
  const w = useWallet();
  if (error && !data) return <ErrorBox msg={error} />;
  if (loading || !data) return <Spinner />;

  const done = data.rounds.filter((r) => r.status === 2);
  const labels = done.map((r) => String(r.id));
  const cur = data.rounds[data.rounds.length - 1];
  const last = done[done.length - 1];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-extrabold">FL Monitor <span className="text-sm font-normal text-mute">· {CHAINS[chainId].name}</span></h1>
        <p className="text-sm text-mute">Dữ liệu đọc trực tiếp từ smart contract, tự làm mới mỗi 5 giây.</p>
      </div>

      <ChainStrip rounds={data.rounds} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Vòng hiện tại" value={data.currentRound ? `#${data.currentRound}` : "—"} sub={cur ? `${STATUS[cur.status]} · ${cur.updateCount}/${data.minUpdates}+ cập nhật` : "Chưa có vòng nào"} tone="violet" />
        <Stat label="Node đã đăng ký" value={data.nodes.length} sub={`${data.nodes.filter((n) => n.active).length} đang hoạt động`} tone="sun" />
        <Stat label="Accuracy (FedAvg)" value={last ? `${last.avgAcc.toFixed(2)}%` : "—"} sub={last ? `Vòng #${last.id}` : "Chờ vòng đầu tiên"} tone="pink" />
        <Stat label="Token BFL đã phát" value={bfl(data.supply, 0)} sub="Tổng cung RewardToken" tone="lime" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Loss theo vòng</h2>
          <LineChart labels={labels} yFmt={(v) => v.toFixed(3)} series={[{ name: "Loss (FedAvg)", color: "var(--color-warn)", values: done.map((r) => r.avgLoss) }]} />
        </div>
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Accuracy theo vòng</h2>
          <LineChart labels={labels} yFmt={(v) => `${v.toFixed(1)}%`} series={[{ name: "Accuracy (FedAvg)", color: "var(--color-brand-2)", values: done.map((r) => r.avgAcc) }]} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card overflow-x-auto p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Các vòng FL</h2>
          {data.rounds.length === 0 ? <Empty>Chưa có vòng nào. Chạy <span className="mono">node bridge/fl_bridge.js --start --finalize</span>.</Empty> : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-mute"><tr><th className="py-1">Vòng</th><th>Trạng thái</th><th>Node</th><th>Mẫu</th><th>Loss</th><th>Acc</th><th>Global hash</th></tr></thead>
              <tbody>
                {[...data.rounds].reverse().map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-2 font-semibold">#{r.id}</td>
                    <td><span className={`chip ${r.status === 2 ? "bg-brand-2/15 text-brand-2" : "bg-warn/15 text-warn"}`}>{STATUS[r.status]}</span></td>
                    <td>{r.updateCount}</td><td>{r.totalSamples}</td>
                    <td>{r.status === 2 ? r.avgLoss.toFixed(4) : "—"}</td><td>{r.status === 2 ? `${r.avgAcc.toFixed(2)}%` : "—"}</td>
                    <td className="mono text-xs text-mute" title={r.globalModelHash}>{r.status === 2 ? short(r.globalModelHash, 8, 6) : "—"}</td>
                  </tr>))}
              </tbody>
            </table>)}
        </div>

        <div className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold">Ví của bạn</h2>
          {w.account ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-mute">Địa chỉ</span><AddrLink chainId={chainId} address={w.account} /></div>
              <div className="flex justify-between"><span className="text-mute">Số dư ETH</span><span>{w.ethBalance ? Number(w.ethBalance).toFixed(4) : "—"}</span></div>
              <div className="flex justify-between"><span className="text-mute">Số dư BFL</span><span className="font-semibold text-brand-2">{w.tokenBalance !== null ? bfl(w.tokenBalance) : "—"}</span></div>
              {w.wrongNetwork && <div className="text-xs text-warn">Ví đang ở chain khác — số dư có thể không khớp mạng đang xem.</div>}
            </div>
          ) : (
            <div className="space-y-3 text-sm text-mute">Kết nối MetaMask để xem địa chỉ ví và số dư token thưởng.
              <button onClick={w.connect} className="block btn-pop rounded-lg bg-brand px-4 py-2 font-semibold text-white">Kết nối MetaMask</button></div>
          )}
          <hr className="border-line" />
          <div className="text-xs text-mute">Global model hash mới nhất</div>
          <div className="mono break-all text-xs">{data.latestGlobalHash === "0x" + "0".repeat(64) ? "—" : data.latestGlobalHash}</div>
        </div>
      </div>

      <div className="card overflow-x-auto p-4">
        <h2 className="mb-3 text-sm font-semibold">Sự kiện gần nhất</h2>
        {data.events.length === 0 ? <Empty>Chưa có sự kiện.</Empty> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-mute"><tr><th className="py-1">Sự kiện</th><th>Vòng</th><th>Node</th><th>TX</th><th>Thời gian</th></tr></thead>
            <tbody>
              {data.events.slice(0, 8).map((e) => (
                <tr key={`${e.txHash}-${e.logIndex}`} className="border-t border-line">
                  <td className="py-2">{e.label}</td>
                  <td>{e.args.roundId !== undefined ? `#${e.args.roundId}` : "—"}</td>
                  <td>{e.args.node ? <AddrLink chainId={chainId} address={e.args.node} /> : "—"}</td>
                  <td><TxLink chainId={chainId} hash={e.txHash} /></td>
                  <td className="text-xs text-mute">{when(e.time)}</td>
                </tr>))}
            </tbody>
          </table>)}
      </div>
    </div>
  );
}
