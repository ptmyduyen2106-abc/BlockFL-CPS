#!/usr/bin/env python3
"""Cơ chế DỰ PHÒNG lấy dữ liệu cảm biến từ Firebase Realtime Database (REST, chỉ dùng thư viện chuẩn).

Đường chính: ESP32 --MQTT--> RPi5.   Đường dự phòng (file này): ESP32 --> Firebase RTDB --> RPi5/laptop.
Dùng khi MQTT/broker hỏng hoặc khi demo không có mạng LAN.

Ví dụ:
  export FIREBASE_DB_URL="https://<project>-default-rtdb.<region>.firebasedatabase.app"
  export FIREBASE_AUTH="<database secret hoặc ID token>"   # bỏ trống nếu rules cho phép đọc công khai
  python3 iot_code/firebase_pull.py --path sensor --once
  python3 iot_code/firebase_pull.py --path sensor --interval 30      # chạy nền, lấy tiếp từ push ID cuối

Kết quả: data/firebase_live.csv (cùng cột với data/uav_clean.csv). Trạng thái resume: data/firebase_state.json.
KHÔNG commit khoá/URL thật vào repo — chỉ đặt trong biến môi trường.
"""
import argparse, csv, json, os, sys, time, urllib.parse, urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from prepare_dataset import clean  # noqa: E402  (cùng luật làm sạch với dữ liệu huấn luyện)

FIELDS = ["push_id", "time_vn", "gas", "humi", "temp", "gas_valid"]


def fetch_page(base, path, after_key, limit, auth, timeout=15):
    q = {"orderBy": '"$key"', "limitToFirst": str(limit + (1 if after_key else 0))}
    if after_key:
        q["startAt"] = json.dumps(after_key)
    if auth:
        q["auth"] = auth
    url = f"{base.rstrip('/')}/{path.strip('/')}.json?{urllib.parse.urlencode(q)}"
    with urllib.request.urlopen(url, timeout=timeout) as r:
        data = json.load(r) or {}
    items = sorted(data.items())
    if after_key and items and items[0][0] == after_key:  # startAt là bao gồm → bỏ bản ghi đã có
        items = items[1:]
    return items


def pull(base, path, state_file, out_file, auth, page=500):
    state = json.load(open(state_file)) if os.path.exists(state_file) else {}
    last, total_new = state.get("last_key"), 0
    new_file = not os.path.exists(out_file)
    with open(out_file, "a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if new_file:
            w.writeheader()
        while True:
            items = fetch_page(base, path, last, page, auth)
            if not items:
                break
            rows = []
            for k, v in items:
                if isinstance(v, dict) and {"gas", "humi", "temp"} <= v.keys():
                    rows.append({"push_id": k, "gas": int(v["gas"]), "humi": int(v["humi"]), "temp": float(v["temp"])})
            good, _ = clean(rows)
            w.writerows(good)
            total_new += len(good)
            last = items[-1][0]
            json.dump({"last_key": last}, open(state_file, "w"))
            if len(items) < page:
                break
    return total_new, last


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=os.environ.get("FIREBASE_DB_URL"))
    ap.add_argument("--path", default=os.environ.get("FIREBASE_PATH", "sensor"))
    ap.add_argument("--out", default="data/firebase_live.csv")
    ap.add_argument("--state", default="data/firebase_state.json")
    ap.add_argument("--interval", type=int, default=0, help="giây; 0 = chạy một lần")
    ap.add_argument("--once", action="store_true")
    a = ap.parse_args()
    if not a.url:
        sys.exit("Thiếu FIREBASE_DB_URL (biến môi trường hoặc --url)")
    auth = os.environ.get("FIREBASE_AUTH")
    while True:
        try:
            n, last = pull(a.url, a.path, a.state, a.out, auth)
            print(f"[{time.strftime('%H:%M:%S')}] +{n} dòng hợp lệ, push ID cuối: {last}", flush=True)
        except Exception as e:  # mạng/quyền lỗi → báo, lần sau thử lại từ push ID cũ
            print(f"[firebase] lỗi: {e}", file=sys.stderr, flush=True)
            if a.once or not a.interval:
                sys.exit(1)
        if a.once or not a.interval:
            break
        time.sleep(a.interval)


if __name__ == "__main__":
    main()
