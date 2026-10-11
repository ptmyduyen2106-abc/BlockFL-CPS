"""Làm sạch dữ liệu cảm biến ESP32 (MQ135 + cảm biến nhiệt/ẩm) trước khi huấn luyện FL.

Các vấn đề thực tế trong file dữ liệu (xem results/data_report.json):
  1. temp = 0 và humi = 0: cảm biến nhiệt/ẩm chưa sẵn sàng hoặc đọc lỗi -> bỏ dòng.
  2. gas ~ 2000 khi cảm biến lỗi (chân ADC thả nổi) -> đi kèm lỗi ở mục 1 nên bị bỏ theo.
  3. `timestamp` do thiết bị ghi sai/thiếu ngày (ESP32 không có RTC) -> khôi phục từ push_id.
  4. gas = 4095: ADC 12-bit bão hòa (ngưỡng trên của MQ135) -> giữ lại, là nhãn cảnh báo.
Nhãn cảnh báo: gas >= ngưỡng. File không có hiệu chuẩn ppm nên ngưỡng mặc định là phân vị 75 của các
giá trị gas hợp lệ (cảnh báo "khí cao bất thường so với nền", chỉnh bằng --alert-percentile).
"""
from __future__ import annotations

import pandas as pd

from data_source import push_id_to_datetime

SEVERE_GAS = 1000        # mức nghiêm trọng (raw ADC), chỉ thống kê
SESSION_GAP_S = 1800   # khoảng lặng > 30 phút = phiên đo mới


def clean(df: pd.DataFrame, alert_percentile: float = 75.0) -> tuple[pd.DataFrame, dict]:
    n0 = len(df)
    out = df.copy()
    out["t"] = out["push_id"].map(push_id_to_datetime)
    out = out.sort_values("t").reset_index(drop=True)
    bad_th = (out.temp <= 0) | (out.humi <= 0)
    stats = {
        "rows_total": int(n0),
        "rows_sensor_fail_temp_humi_zero": int(bad_th.sum()),
        "rows_timestamp_missing_date": int((out.timestamp.str.len() != 19).sum()),
        "gas_saturated_4095_before_filter": int((out.gas >= 4095).sum()),
    }
    out = out[~bad_th].reset_index(drop=True)
    gap = out.t.diff().dt.total_seconds()
    out["session"] = (gap > SESSION_GAP_S).cumsum().astype(int)
    thr = float(out.gas.quantile(alert_percentile / 100))
    out["alert"] = (out.gas >= thr).astype(int)
    stats.update({
        "rows_valid": int(len(out)),
        "valid_ratio": round(len(out) / n0, 4),
        "sessions": int(out.session.nunique()),
        "alert_threshold_gas": thr, "alert_percentile": alert_percentile,
        "severe_rows_gas_ge_1000": int((out.gas >= SEVERE_GAS).sum()),
        "alert_rows": int(out.alert.sum()),
        "alert_ratio": round(float(out.alert.mean()), 4),
        "time_range": [str(out.t.min()), str(out.t.max())],
        "gas": {"median": float(out.gas.median()), "p95": float(out.gas.quantile(.95)), "max": float(out.gas.max())},
        "temp_mean": round(float(out.temp.mean()), 2), "humi_mean": round(float(out.humi.mean()), 2),
    })
    return out, stats
