"use client";
import useSensorData from "./useSensorData";
import { LineChart, Stat } from "./ui";
import { FIREBASE_DB_URL } from "@/lib/firebase";

const hhmm = (ms) => new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

/** Dữ liệu cảm biến realtime từ Firebase (đường dự phòng của ESP32 → RTDB) */
export default function SensorPanel() {
  const { rows, error } = useSensorData();
  if (!FIREBASE_DB_URL) return null;
  const last = rows?.[rows.length - 1];
  const labels = (rows || []).map((r) => hhmm(r.time));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-xl font-extrabold">Cảm biến realtime <span className="text-sm font-normal text-mute">· Firebase RTDB</span></h2>
        <a className="ext text-xs" href={FIREBASE_DB_URL} target="_blank" rel="noreferrer">Mở Firebase ↗</a>
      </div>
      {error && !rows ? (
        <div className="card border-bad/40 p-4 text-sm text-bad">⚠ Không đọc được Firebase: {error}</div>
      ) : !rows ? (
        <div className="p-4 text-center text-sm text-mute">Đang tải dữ liệu cảm biến…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Nhiệt độ" value={last ? `${last.temp.toFixed(1)}°C` : "—"} sub={last ? `Lúc ${hhmm(last.time)}` : "Chưa có bản ghi"} tone="sun" />
            <Stat label="Độ ẩm" value={last ? `${last.humi}%` : "—"} sub="DHT" tone="violet" />
            <Stat label="Khí gas (MQ ADC)" value={last ? last.gas : "—"} sub={last && (last.gas <= 0 || last.gas >= 4095) ? "Tín hiệu MQ không hợp lệ" : "12-bit ADC"} tone="pink" />
            <Stat label="Số bản ghi hiển thị" value={rows.length} sub="Mới nhất từ Firebase" tone="lime" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h3 className="mb-2 text-sm font-semibold">Nhiệt độ (°C)</h3>
              <LineChart labels={labels} yFmt={(v) => v.toFixed(1)} series={[{ name: "Temp", color: "var(--color-warn)", values: rows.map((r) => r.temp) }]} />
            </div>
            <div className="card p-4">
              <h3 className="mb-2 text-sm font-semibold">Độ ẩm (%)</h3>
              <LineChart labels={labels} yFmt={(v) => `${v.toFixed(0)}%`} series={[{ name: "Humi", color: "var(--color-brand-2)", values: rows.map((r) => r.humi) }]} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
