"use client";
import { useState } from "react";
import useChainData from "@/components/useChainData";
import { useWallet } from "@/components/WalletProvider";
import { AddrLink, Empty, ErrorBox, Spinner } from "@/components/ui";
import { bfl, when } from "@/lib/format";
import { flContract } from "@/lib/fl";

export default function Nodes() {
  const { data, error, loading, reload, chainId } = useChainData();
  const w = useWallet();
  const [meta, setMeta] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  if (error && !data) return <ErrorBox msg={error} />;
  if (loading || !data) return <Spinner />;

  const mine = w.account && data.nodes.some((n) => n.address.toLowerCase() === w.account.toLowerCase());
  const register = async () => {
    setBusy(true); setMsg("");
    try {
      const signer = await w.getSigner();
      const tx = await flContract(chainId, signer).registerNode(meta || "dashboard-node");
      setMsg(`Đang chờ xác nhận… ${tx.hash}`); await tx.wait(); setMsg("✔ Đã đăng ký node on-chain"); setMeta(""); reload(); w.refreshBalances();
    } catch (e) { setMsg("✘ " + (e.shortMessage || e.message)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Bảng node <span className="text-sm font-normal text-mute">· {data.nodes.length} node</span></h1>

      <div className="card overflow-x-auto p-4">
        {data.nodes.length === 0 ? <Empty>Chưa có node nào đăng ký.</Empty> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-mute"><tr><th className="py-1">Địa chỉ</th><th>Mô tả</th><th>Trạng thái</th><th>Số lần gửi</th><th>Thưởng nhận</th><th>Số dư BFL</th><th>Đăng ký</th></tr></thead>
            <tbody>
              {data.nodes.map((n) => (
                <tr key={n.address} className="border-t border-line">
                  <td className="py-2"><AddrLink chainId={chainId} address={n.address} />{w.account?.toLowerCase() === n.address.toLowerCase() && <span className="chip ml-2 bg-brand/20 text-brand">Bạn</span>}</td>
                  <td>{n.metadata}</td>
                  <td><span className={`chip ${n.active ? "bg-brand-2/15 text-brand-2" : "bg-bad/15 text-bad"}`}>{n.active ? "Hoạt động" : "Bị khóa"}</span></td>
                  <td>{n.totalUpdates}</td><td>{bfl(n.totalRewards)}</td><td className="font-semibold">{bfl(n.balance)}</td>
                  <td className="text-xs text-mute">{when(n.registeredAt)}</td>
                </tr>))}
            </tbody>
          </table>)}
      </div>

      <div className="card max-w-xl space-y-3 p-4">
        <h2 className="text-sm font-semibold">Đăng ký ví hiện tại làm node FL</h2>
        {!w.account ? <p className="text-sm text-mute">Kết nối MetaMask để đăng ký.</p>
          : mine ? <p className="text-sm text-brand-2">Ví này đã là node.</p>
          : (<div className="flex gap-2">
              <input value={meta} onChange={(e) => setMeta(e.target.value)} maxLength={128} placeholder="Mô tả, vd: ESP32-04 | BME280"
                className="flex-1 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-brand" />
              <button disabled={busy || w.wrongNetwork} onClick={register} className="btn-pop rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Đang gửi…" : "Đăng ký"}</button>
            </div>)}
        {w.wrongNetwork && <p className="text-xs text-warn">Chuyển ví sang đúng mạng trước khi đăng ký.</p>}
        {msg && <p className="mono break-all text-xs text-mute">{msg}</p>}
      </div>
    </div>
  );
}
