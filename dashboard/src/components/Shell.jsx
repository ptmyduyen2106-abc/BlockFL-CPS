"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CHAINS } from "@/lib/chains";
import { bfl, short } from "@/lib/format";
import { useWallet } from "./WalletProvider";

const NAV = [
  { href: "/", label: "Tổng quan", icon: "▦" },
  { href: "/nodes", label: "Node", icon: "◉" },
  { href: "/transactions", label: "Giao dịch on-chain", icon: "⇄" },
];

export default function Shell({ children }) {
  const path = usePathname();
  const w = useWallet();
  return (
    <div className="flex min-h-screen">
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-line bg-panel/60 p-4 gap-1">
        <div className="mb-6 px-2">
          <div className="text-lg font-bold tracking-tight">Block<span className="text-brand">FL</span></div>
          <div className="text-xs text-mute">Federated Learning × Blockchain</div>
        </div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${path === n.href ? "bg-brand/15 text-ink" : "text-mute hover:bg-panel-2 hover:text-ink"}`}>
            <span className="w-4 text-center">{n.icon}</span>{n.label}
          </Link>
        ))}
        <div className="mt-auto px-2 text-[11px] leading-relaxed text-mute">CPS 3 tầng: IoT/Edge → AI (FedAvg) → Smart Contract</div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur">
          <div className="md:hidden font-bold">Block<span className="text-brand">FL</span></div>
          <div className="flex items-center gap-2 text-xs text-mute"><span className="live-dot" />Realtime</div>
          <select value={w.readChain} onChange={(e) => w.setReadChain(Number(e.target.value))}
            className="rounded-lg border border-line bg-panel px-2 py-1.5 text-xs">
            {Object.values(CHAINS).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <nav className="flex gap-1 md:hidden">
            {NAV.map((n) => <Link key={n.href} href={n.href} className={`rounded px-2 py-1 text-xs ${path === n.href ? "bg-brand/20" : "text-mute"}`}>{n.label}</Link>)}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {w.account ? (
              <>
                <span className="chip bg-brand-2/15 text-brand-2" title="Số dư token thưởng">{w.tokenBalance !== null ? `${bfl(w.tokenBalance)} BFL` : "BFL —"}</span>
                <span className="chip bg-panel-2 text-mute">{w.ethBalance ? `${Number(w.ethBalance).toFixed(4)} ETH` : "—"}</span>
                <span className="chip mono bg-panel-2" title={w.account}>{short(w.account)}</span>
                <button onClick={w.disconnect} className="rounded-lg border border-line px-3 py-1.5 text-xs text-mute hover:text-ink">Ngắt</button>
              </>
            ) : (
              <button onClick={w.connect} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">Kết nối MetaMask</button>
            )}
          </div>
        </header>

        {(w.error || w.wrongNetwork || !w.hasMetaMask) && (
          <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn">
            {!w.hasMetaMask && <span>Không tìm thấy MetaMask — <a className="underline" href="https://metamask.io" target="_blank">cài extension</a> để kết nối ví.</span>}
            {w.error && <span>{w.error}</span>}
            {w.wrongNetwork && (
              <>
                <span>Ví đang ở chain {w.walletChain}, dashboard đọc {CHAINS[w.readChain].name}.</span>
                <button onClick={() => w.switchChain(w.readChain)} className="rounded bg-warn px-2 py-0.5 text-xs font-semibold text-black">Chuyển mạng ví</button>
              </>
            )}
          </div>
        )}
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
