"use client";
import useSensorData from "./useSensorData";
import { LineChart, Stat } from "./ui";
import { FIREBASE_DB_URL } from "@/lib/firebase";

const hhmm = (ms) => new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
// chỉ in nhãn trục x thưa để không bị chồng chữ
const sparse = (arr, fmt) => arr.map((r, i) => (i % Math.max(1, Math.ceil(arr.length / 6)) === 0 ? fmt(r) : ""));

/** Dữ liệu cảm biến realtime từ Firebase RTDB: giá trị hiện tại (/sensor) + lịch sử (/uav_logs) */
export default function SensorPanel() {
  const { data, error } = useSensorData();
  if (!FIREBASE_DB_URL) return null;
  const live = data?.live, hist = data?.history || [], th = data?.thresholds;
  const lastGas = hist[hist.length - 1]?.gas;
  const labels = sparse(hist, (r) => hhmm(r.time));
  const hasTH = hist.some((r) => r.temp !== null || r.humi !== null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-xl font-extrabold">Cảm biến realtime <span className="text-sm font-normal text-mute">· Firebase RTDB</span></h2>
        <a className="ext text-xs" href={FIREBASE_DB_URL} target="_blank" rel="noreferrer">Mở Firebase ↗</a>
      </div>
      {error && !data ? (
        <div className="card border-bad/40 p-4 text-sm text-bad">⚠ Không đọc được Firebase: {error}</div>
      ) : !data ? (
        <div className="p-4 text-center text-sm text-mute">Đang tải dữ liệu cảm biến…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Nhiệt độ" value={live ? `${live.temp}°C` : "—"} sub={th && live && live.temp > th.temperatureMax ? `⚠ Vượt ngưỡng ${th.temperatureMax}°C` : "Giá trị hiện tại"} tone="sun" />
            <Stat label="Độ ẩm" value={live ? `${live.humi}%` : "—"} sub="Giá trị hiện tại" tone="violet" />
            <Stat label="Khí gas (MQ ADC)" value={lastGas ?? "—"} sub={th && lastGas > th.gasMax ? `⚠ Vượt ngưỡng ${th.gasMax}` : "Bản ghi mới nhất"} tone="pink" />
            <Stat label="Bụi" value={live?.dust ?? "—"} sub={`${hist.length} bản ghi lịch sử`} tone="lime" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h3 className="mb-2 text-sm font-semibold">Gas theo thời gian</h3>
              <LineChart labels={labels} yFmt={(v) => v.toFixed(0)} series={[{ name: "Gas", color: "var(--color-warn)", values: hist.map((r) => r.gas) }]} />
            </div>
            <div className="card p-4">
              <h3 className="mb-2 text-sm font-semibold">Nhiệt độ & độ ẩm theo thời gian</h3>
              {hasTH
                ? <LineChart labels={labels} yFmt={(v) => v.toFixed(0)} series={[
                    { name: "Temp (°C)", color: "var(--color-warn)", values: hist.map((r) => r.temp) },
                    { name: "Humi (%)", color: "var(--color-brand-2)", values: hist.map((r) => r.humi) }]} />
                : <div className="p-6 text-center text-sm text-mute">Các bản ghi lịch sử gần đây chưa có nhiệt độ/độ ẩm hợp lệ (DHT trả 0).</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
