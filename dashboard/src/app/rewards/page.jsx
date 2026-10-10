"use client";
import { useMemo } from "react";
import useChainData from "@/components/useChainData";
import { useWallet } from "@/components/WalletProvider";
import { AddrLink, Empty, ErrorBox, LineChart, Spinner, Stat, StackedBars, TxLink } from "@/components/ui";
import { bfl, short, when } from "@/lib/format";
import { buildRewards } from "@/lib/rewards";

export default function Rewards() {
  const { data, error, loading, chainId } = useChainData();
  const w = useWallet();
  const R = useMemo(() => (data ? buildRewards(data) : null), [data]);
  if (error && !data) return <ErrorBox msg={error} />;
  if (loading || !data || !R) return <Spinner />;

  const labels = R.byRound.map((r) => String(r.round));
  const nodeName = (a) => R.nodes.find((n) => R.key(n.address) === R.key(a))?.metadata || short(a);
  const last = R.byRound[R.byRound.length - 1];
  const me = w.account ? R.perNode.find((n) => R.key(n.address) === R.key(w.account)) : null;
  const myPaid = w.account ? R.paid.filter((p) => R.key(p.node) === R.key(w.account)) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-extrabold">Thưởng BFL</h1>
        <p className="text-sm text-mute">Suy ra từ sự kiện <span className="mono">RewardPaid</span> của FLManager — không cần đổi contract. Mỗi dòng đều có TX kiểm chứng được trên Etherscan.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Đã trả thưởng" value={bfl(R.totalPaid, 2)} sub={`${R.paid.length} giao dịch RewardPaid`} tone="lime" />
        <Stat label="Quỹ thưởng đã mở" value={bfl(R.totalPool, 0)} sub={`${R.byRound.length} vòng đã chốt`} tone="violet" />
        <Stat label="Tổng cung BFL" value={bfl(data.supply, 2)} sub="RewardToken.totalSupply()" tone="sun" />
        <Stat label="Đối soát" value={R.reconciled ? "Khớp ✔" : "Lệch ⚠"} sub={R.reconciled ? "Σ RewardPaid = tổng cung" : "Tổng cung ≠ Σ RewardPaid (có mint ngoài FLManager?)"} tone={R.reconciled ? "sky" : "pink"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Thưởng theo vòng (xếp chồng theo node)</h2>
          <StackedBars labels={labels} yFmt={(v) => v.toFixed(0)}
            series={R.perNode.map((n) => ({ name: n.metadata || short(n.address), color: n.color, values: R.byRound.map((r) => R.toBfl(r.sum[R.key(n.address)] ?? 0n)) }))} />
        </div>
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Thưởng tích luỹ theo node</h2>
          <LineChart labels={labels} yFmt={(v) => v.toFixed(0)}
            series={R.perNode.map((n) => ({ name: n.metadata || short(n.address), color: n.color, values: n.cumulative }))} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card overflow-x-auto p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Bảng thưởng theo node</h2>
          {R.perNode.length === 0 ? <Empty>Chưa có node.</Empty> : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-mute"><tr><th className="py-1">Node</th><th>Tổng mẫu</th><th>Thưởng nhận</th><th>Tỉ lệ</th><th>Số dư BFL</th></tr></thead>
              <tbody>
                {R.perNode.map((n) => (
                  <tr key={n.address} className="border-t border-line">
                    <td className="py-2"><i className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: n.color }} /><AddrLink chainId={chainId} address={n.address} /><div className="text-xs text-mute">{n.metadata}</div></td>
                    <td>{n.samples}</td><td className="font-semibold">{bfl(n.total)}</td>
                    <td>{R.totalPaid > 0n ? `${((Number(n.total) / Number(R.totalPaid)) * 100).toFixed(2)}%` : "—"}</td>
                    <td>{bfl(n.balance)}</td>
                  </tr>))}
              </tbody>
            </table>)}
        </div>

        <div className="card space-y-2 p-4 text-sm">
          <h2 className="font-semibold">Luật thưởng (on-chain)</h2>
          <p className="mono rounded bg-panel-2 px-2 py-1 text-xs">reward_i = pool × n_i / N</p>
          <p className="text-xs text-mute">n_i: số mẫu node i khai báo · N = Σ n_i của vòng · làm tròn xuống, phần dư (dust) ở lại.</p>
          {last ? (
            <div className="rounded-lg border border-line p-2 text-xs">
              <div className="mb-1 font-semibold">Ví dụ thật — vòng #{last.round} (pool {bfl(last.pool, 0)} BFL, N = {last.totalSamples})</div>
              {Object.entries(last.samples).map(([a, n]) => (
                <div key={a} className="flex justify-between gap-2"><span className="truncate">{nodeName(a)}</span><span className="mono">{n} → {bfl(last.sum[a] ?? 0n)} BFL</span></div>))}
              <div className="mt-1 text-mute">Dust: {bfl(last.dust, 6)} BFL</div>
            </div>) : <p className="text-xs text-mute">Chưa có vòng đã chốt để minh hoạ.</p>}
          <p className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs text-warn">Hạn chế: <b>n_i do node tự khai</b>, chưa có cọc/phạt. Đề xuất stake + slash + thưởng theo chất lượng: xem <span className="mono">docs/REWARDS_STAKE_SLASH.md</span>.</p>
        </div>
      </div>

      {w.account && (
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Ví của bạn</h2>
          {me ? <p className="text-sm">Đã nhận <b>{bfl(me.total)} BFL</b> qua {myPaid.length} lần trả thưởng · số dư hiện tại {bfl(me.balance)} BFL.</p>
            : <p className="text-sm text-mute">Ví này chưa phải node FL nên chưa có thưởng.</p>}
        </div>)}

      <div className="card overflow-x-auto p-4">
        <h2 className="mb-3 text-sm font-semibold">Lịch sử trả thưởng <span className="font-normal text-mute">· bằng chứng cho báo cáo</span></h2>
        {R.paid.length === 0 ? <Empty>Chưa có sự kiện RewardPaid. Chốt một vòng có quỹ thưởng &gt; 0.</Empty> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-mute"><tr><th className="py-1">Vòng</th><th>Node</th><th>Số BFL</th><th>Thời gian</th><th>TX</th><th>Block</th></tr></thead>
            <tbody>
              {[...R.paid].reverse().map((p) => (
                <tr key={`${p.txHash}-${p.node}`} className="border-t border-line">
                  <td className="py-2 font-semibold">#{p.round}</td><td><AddrLink chainId={chainId} address={p.node} /></td>
                  <td className="font-semibold text-brand-2">+{bfl(p.amount)}</td><td className="text-xs text-mute">{when(p.time)}</td>
                  <td><TxLink chainId={chainId} hash={p.txHash} /></td><td className="mono text-xs text-mute">{p.block}</td>
                </tr>))}
            </tbody>
          </table>)}
      </div>
    </div>
  );
}
