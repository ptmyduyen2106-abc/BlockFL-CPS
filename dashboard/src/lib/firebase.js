// Đọc dữ liệu cảm biến từ Firebase Realtime Database (REST, không cần SDK).
// Cấu trúc RTDB của dự án:
//   /sensor                      – giá trị HIỆN TẠI {temp, humi, dust, mpu}
//   /uav_logs/<pushId>           – LỊCH SỬ {gas, humi, temp, alt, lat, lng, timestamp}
//   /settings/thresholds         – ngưỡng cảnh báo {gasMax, temperatureMax, humidityMin}
// Cấu hình qua biến môi trường (xem .env.example):
//   NEXT_PUBLIC_FIREBASE_DB_URL  – URL gốc của RTDB
//   NEXT_PUBLIC_FIREBASE_PATH    – node lịch sử (mặc định "uav_logs")
export const FIREBASE_DB_URL = (process.env.NEXT_PUBLIC_FIREBASE_DB_URL || "").replace(/\/+$/, "");
export const FIREBASE_PATH = (process.env.NEXT_PUBLIC_FIREBASE_PATH || "uav_logs").replace(/^\/+|\/+$/g, "");

const ALPHABET = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
/** Firebase push ID mã hoá mili-giây trong 8 ký tự đầu (trường timestamp trong log không đáng tin) */
export const pushTime = (id) => {
  let t = 0;
  for (const c of id.slice(0, 8)) t = t * 64 + ALPHABET.indexOf(c);
  return t;
};

const get = async (path, params) => {
  const qs = params ? `?${new URLSearchParams(params)}` : "";
  const res = await fetch(`${FIREBASE_DB_URL}/${path}.json${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Firebase trả về ${res.status}${res.status === 401 ? " – kiểm tra rules đọc" : ""}`);
  return res.json();
};

// DHT trả 0 khi đọc lỗi → coi là "không có dữ liệu" (null) thay vì vẽ số 0
const valid = (v) => (Number(v) > 0 ? Number(v) : null);
// MQ: 0 = mất tín hiệu, 4095 = bão hoà ADC 12-bit → không hợp lệ
const validGas = (v) => (Number(v) > 0 && Number(v) < 4095 ? Number(v) : null);

/** Giá trị hiện tại + N bản ghi lịch sử mới nhất + ngưỡng cảnh báo */
export async function loadSensorData(limit = 60) {
  if (!FIREBASE_DB_URL) throw new Error("Chưa cấu hình NEXT_PUBLIC_FIREBASE_DB_URL");
  const [live, logs, thresholds] = await Promise.all([
    get("sensor"),
    get(FIREBASE_PATH, { orderBy: '"$key"', limitToLast: String(limit) }),
    get("settings/thresholds").catch(() => null),
  ]);
  const history = Object.entries(logs || {})
    .filter(([, v]) => v && typeof v === "object" && "gas" in v)
    .map(([id, v]) => ({ id, time: pushTime(id), gas: validGas(v.gas), gasRaw: Number(v.gas), humi: valid(v.humi), temp: valid(v.temp) }))
    .sort((a, b) => a.time - b.time);
  return { live: live && typeof live === "object" ? live : null, history, thresholds };
}
