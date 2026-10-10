#!/usr/bin/env python3
"""Làm sạch dữ liệu cảm biến xuất từ Firebase RTDB (gas, humi, temp, timestamp, push_id).

Chạy:  python3 scripts/prepare_dataset.py [raw.csv] [out.csv]
Mặc định: data/raw/uav_filtered_data.csv -> data/uav_clean.csv

Điểm mấu chốt: cột `timestamp` của file xuất KHÔNG đáng tin (xem docs/DATASET.md),
nên thời gian thật được khôi phục từ `push_id` (Firebase push ID mã hoá mili-giây
trong 8 ký tự đầu, bảng chữ cái 64 ký tự).
"""
import csv, sys, datetime as dt
from collections import Counter

ALPHABET = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz"
TZ = dt.timezone(dt.timedelta(hours=7))  # giờ Việt Nam


def push_time(push_id: str) -> dt.datetime:
    t = 0
    for c in push_id[:8]:
        t = t * 64 + ALPHABET.index(c)
    return dt.datetime.fromtimestamp(t / 1000, TZ)


def clean(rows):
    """Giữ dòng có DHT hợp lệ; cột gas_valid=0 đánh dấu dòng MQ lỗi (0 hoặc 4095)."""
    out, drop = [], Counter()
    for r in rows:
        gas, humi, temp = int(r["gas"]), int(r["humi"]), float(r["temp"])
        if humi <= 0 or temp <= 0:               # DHT trả 0 khi đọc lỗi
            drop["dht_loi(humi=0 hoac temp=0)"] += 1
            continue
        gas_valid = int(0 < gas < 4095)          # 0 = mất tín hiệu, 4095 = bão hoà ADC 12-bit
        out.append({"push_id": r["push_id"], "time_vn": push_time(r["push_id"]).strftime("%Y-%m-%d %H:%M:%S"),
                    "gas": gas, "humi": humi, "temp": temp, "gas_valid": gas_valid})
    return out, drop


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "data/raw/uav_filtered_data.csv"
    dst = sys.argv[2] if len(sys.argv) > 2 else "data/uav_clean.csv"
    with open(src, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    out, drop = clean(rows)
    out.sort(key=lambda r: r["push_id"])  # push ID tăng dần theo thời gian
    with open(dst, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["push_id", "time_vn", "gas", "humi", "temp", "gas_valid"])
        w.writeheader(); w.writerows(out)
    print(f"raw={len(rows)}  giữ={len(out)}  loại={len(rows)-len(out)}")
    for k, v in drop.items():
        print(f"  loại {v:4d} dòng: {k}")
    print(f"  trong đó gas hợp lệ: {sum(r['gas_valid'] for r in out)}")
    print(f"-> {dst}")


if __name__ == "__main__":
    main()
