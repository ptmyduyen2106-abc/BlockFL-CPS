import { formatUnits } from "ethers";
export const short = (s, a = 6, b = 4) => (s ? `${s.slice(0, a)}…${s.slice(-b)}` : "—");
export const bfl = (v, d = 2) => (v === undefined || v === null ? "—" : Number(formatUnits(v, 18)).toLocaleString("vi-VN", { maximumFractionDigits: d }));
export const when = (t) => (t ? new Date(t * 1000).toLocaleString("vi-VN") : "—");
