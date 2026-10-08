"use client";
import { addrUrl, txUrl } from "@/lib/chains";
import { short } from "@/lib/format";

export const Stat = ({ label, value, sub, accent }) => (
  <div className="card p-4">
    <div className="text-xs uppercase tracking-wider text-mute">{label}</div>
    <div className={`mt-1 text-2xl font-bold ${accent || ""}`}>{value}</div>
    {sub && <div className="mt-1 text-xs text-mute">{sub}</div>}
  </div>
);

/** Link Etherscan cho TX hash; mạng local không có explorer → chỉ hiển thị hash */
export function TxLink({ chainId, hash }) {
  const u = txUrl(chainId, hash);
  return u
    ? <a className="ext mono" href={u} target="_blank" rel="noreferrer" title={hash}>{short(hash, 8, 6)} ↗</a>
    : <span className="mono text-mute" title={`${hash} (mạng local – không có Etherscan)`}>{short(hash, 8, 6)}</span>;
}
export function AddrLink({ chainId, address }) {
  const u = addrUrl(chainId, address);
  return u
    ? <a className="ext mono" href={u} target="_blank" rel="noreferrer" title={address}>{short(address)} ↗</a>
    : <span className="mono" title={address}>{short(address)}</span>;
}

export const Empty = ({ children }) => <div className="card p-8 text-center text-sm text-mute">{children}</div>;
export const Spinner = () => <div className="p-8 text-center text-sm text-mute">Đang tải dữ liệu on-chain…</div>;
export const ErrorBox = ({ msg }) => <div className="card border-bad/40 p-4 text-sm text-bad">⚠ {msg}</div>;

/** Biểu đồ đường SVG nhỏ (không cần thư viện) */
export function LineChart({ series, labels, height = 180, yFmt = (v) => v }) {
  const W = 560, H = height, P = { l: 40, r: 12, t: 12, b: 24 };
  const all = series.flatMap((s) => s.values).filter((v) => v !== null);
  if (!all.length) return <div className="p-6 text-center text-sm text-mute">Chưa có dữ liệu vòng đã chốt</div>;
  const min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
  const n = labels.length;
  const x = (i) => P.l + (n === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (n - 1));
  const y = (v) => P.t + (1 - (v - min) / span) * (H - P.t - P.b);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Biểu đồ theo vòng">
        {[0, 0.5, 1].map((t) => { const v = min + span * t; return (
          <g key={t}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeDasharray="3 4" />
            <text x={P.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--color-mute)">{yFmt(v)}</text></g>); })}
        {labels.map((l, i) => <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-mute)">{l}</text>)}
        {series.map((s) => (
          <g key={s.name}>
            <polyline fill="none" stroke={s.color} strokeWidth="2.2" points={s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ")} />
            {s.values.map((v, i) => v !== null && <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill={s.color}><title>{`${s.name} – vòng ${labels[i]}: ${yFmt(v)}`}</title></circle>)}
          </g>))}
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-mute">{series.map((s) => <span key={s.name} className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}</span>)}</div>
    </div>
  );
}
