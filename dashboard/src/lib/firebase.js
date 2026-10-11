// Đọc dữ liệu cảm biến từ Firebase Realtime Database (REST, không cần SDK).
// Cấu hình qua biến môi trường (xem .env.example):
//   NEXT_PUBLIC_FIREBASE_DB_URL  – URL gốc của RTDB
//   NEXT_PUBLIC_FIREBASE_PATH    – node chứa bản ghi cảm biến (mặc định "sensor")
export const FIREBASE_DB_URL = (process.env.NEXT_PUBLIC_FIREBASE_DB_URL || "").replace(/\/+$/, "");
export const FIREBASE_PATH = (process.env.NEXT_PUBLIC_FIREBASE_PATH || "sensor").replace(/^\/+|\/+$/g, "");

const ALPHABET = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
/** Firebase push ID mã hoá mili-giây trong 8 ký tự đầu (cột timestamp xuất file không đáng tin) */
export const pushTime = (id) => {
  let t = 0;
  for (const c of id.slice(0, 8)) t = t * 64 + ALPHABET.indexOf(c);
  return t;
};

/** Lấy N bản ghi mới nhất, đã lọc dòng DHT lỗi (humi/temp = 0) */
export async function loadSensorData(limit = 60) {
  if (!FIREBASE_DB_URL) throw new Error("Chưa cấu hình NEXT_PUBLIC_FIREBASE_DB_URL");
  const q = new URLSearchParams({ orderBy: '"$key"', limitToLast: String(limit) });
  const res = await fetch(`${FIREBASE_DB_URL}/${FIREBASE_PATH}.json?${q}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Firebase trả về ${res.status}${res.status === 401 ? " – kiểm tra rules đọc" : ""}`);
  const raw = (await res.json()) || {};
  return Object.entries(raw)
    .filter(([, v]) => v && typeof v === "object" && "gas" in v && "humi" in v && "temp" in v)
    .map(([id, v]) => ({ id, time: pushTime(id), gas: Number(v.gas), humi: Number(v.humi), temp: Number(v.temp) }))
    .filter((r) => r.humi > 0 && r.temp > 0)
    .sort((a, b) => a.time - b.time);
}
