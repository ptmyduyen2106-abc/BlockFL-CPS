"""Nguồn dữ liệu cảm biến: CSV (chính) + Firebase Realtime Database (dự phòng / bổ sung).

ESP32 đẩy mỗi bản ghi lên Firebase bằng push() nên khóa của bản ghi chính là *push_id*
({gas, humi, temp, timestamp}). push_id vừa là khóa duy nhất (dùng để khử trùng lặp khi gộp
CSV + Firebase) vừa mã hóa thời gian máy chủ thực (8 ký tự đầu, ms) nên khôi phục được mốc
thời gian đúng khi trường `timestamp` do thiết bị ghi bị thiếu ngày hoặc sai (ESP32 không có RTC).

Cấu hình Firebase qua biến môi trường (không ghi khóa vào mã nguồn):
    FIREBASE_DB_URL   vd: https://<project-id>-default-rtdb.firebaseio.com
    FIREBASE_DB_PATH  nhánh chứa bản ghi, vd: sensor_data   (mặc định: gốc "")
    FIREBASE_AUTH     (tuỳ chọn) database secret / ID token nếu rules không public
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

COLUMNS = ["gas", "humi", "temp", "timestamp", "push_id"]
_ALPHABET = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz"
HERE = Path(__file__).resolve().parent
DEFAULT_CSV = HERE / "data" / "uav_filtered_data.csv"
FIREBASE_CACHE = HERE / "data" / "firebase_cache.csv"


class DataSourceError(RuntimeError):
    pass


def push_id_to_datetime(push_id: str) -> pd.Timestamp:
    """Giải mã 8 ký tự đầu của Firebase push ID -> thời điểm (giờ Việt Nam, naive)."""
    ms = 0
    for ch in push_id[:8]:
        ms = ms * 64 + _ALPHABET.index(ch)
    return pd.to_datetime(ms, unit="ms", utc=True).tz_convert("Asia/Ho_Chi_Minh").tz_localize(None)


def _normalize(df: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in COLUMNS if c not in df.columns]
    if missing:
        raise DataSourceError(f"Thiếu cột {missing}")
    df = df[COLUMNS].copy()
    for c in ("gas", "humi", "temp"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["timestamp"] = df["timestamp"].astype(str)
    df["push_id"] = df["push_id"].astype(str)
    return df.dropna(subset=["gas", "humi", "temp"])


def read_csv(path: str | os.PathLike = DEFAULT_CSV) -> pd.DataFrame:
    p = Path(path)
    if not p.exists():
        raise DataSourceError(f"Không thấy file CSV: {p}")
    return _normalize(pd.read_csv(p, encoding="utf-8-sig"))


@dataclass
class FirebaseConfig:
    db_url: str = field(default_factory=lambda: os.environ.get("FIREBASE_DB_URL", ""))
    path: str = field(default_factory=lambda: os.environ.get("FIREBASE_DB_PATH", ""))
    auth: str = field(default_factory=lambda: os.environ.get("FIREBASE_AUTH", ""))
    limit: int = 5000          # lấy tối đa N bản ghi mới nhất
    timeout: float = 10.0
    retries: int = 3

    @property
    def configured(self) -> bool:
        return bool(self.db_url)


def read_firebase(cfg: FirebaseConfig | None = None) -> pd.DataFrame:
    """Đọc N bản ghi mới nhất qua Firebase REST API (orderBy="$key" & limitToLast)."""
    cfg = cfg or FirebaseConfig()
    if not cfg.configured:
        raise DataSourceError("Chưa cấu hình FIREBASE_DB_URL")
    path = cfg.path.strip("/")
    url = f"{cfg.db_url.rstrip('/')}/{path}.json" if path else f"{cfg.db_url.rstrip('/')}/.json"
    params = {"orderBy": '"$key"', "limitToLast": str(cfg.limit)}
    if cfg.auth:
        params["auth"] = cfg.auth
    url += "?" + urllib.parse.urlencode(params)

    last_err: Exception | None = None
    for attempt in range(cfg.retries):
        try:
            with urllib.request.urlopen(url, timeout=cfg.timeout) as r:
                payload = json.loads(r.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as e:      # 401/403/404: thử lại không có ích
            raise DataSourceError(f"Firebase trả HTTP {e.code} ({e.reason})") from e
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as e:
            last_err = e
            time.sleep(min(2 ** attempt * 0.2, 2))
    else:
        raise DataSourceError(f"Không kết nối được Firebase: {last_err}")

    if payload is None:
        raise DataSourceError("Nhánh Firebase rỗng")
    if isinstance(payload, dict) and "error" in payload:
        raise DataSourceError(f"Firebase lỗi: {payload['error']}")
    if not isinstance(payload, dict):
        raise DataSourceError("Định dạng Firebase không phải {push_id: bản ghi}")
    rows = []
    for pid, rec in payload.items():
        if isinstance(rec, dict):
            rows.append({"push_id": pid, "gas": rec.get("gas"), "humi": rec.get("humi"),
                         "temp": rec.get("temp"), "timestamp": rec.get("timestamp", "")})
    if not rows:
        raise DataSourceError("Không có bản ghi hợp lệ trên Firebase")
    return _normalize(pd.DataFrame(rows, columns=COLUMNS)).sort_values("push_id").reset_index(drop=True)


def load(sources: tuple[str, ...] = ("csv", "firebase"), *, csv_path=DEFAULT_CSV,
         firebase: FirebaseConfig | None = None, min_rows: int = 1, merge: bool = False,
         cache_path=FIREBASE_CACHE, log=print) -> tuple[pd.DataFrame, dict]:
    """Lấy dữ liệu theo thứ tự ưu tiên `sources`; nguồn lỗi/thiếu dòng thì chuyển sang nguồn kế.

    merge=True: đọc mọi nguồn khả dụng rồi gộp, khử trùng lặp theo push_id.
    Trả về (DataFrame đã sắp xếp theo push_id, thông tin nguồn đã dùng).
    """
    got: dict[str, pd.DataFrame] = {}
    errors: dict[str, str] = {}
    for name in sources:
        try:
            if name == "csv":
                df = read_csv(csv_path)
            elif name == "firebase":
                df = read_firebase(firebase)
                try:
                    Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
                    df.to_csv(cache_path, index=False)      # lưu đệm để lần sau chạy offline
                except OSError:
                    pass
            elif name == "firebase_cache":
                df = read_csv(cache_path)
            else:
                raise DataSourceError(f"Nguồn không hỗ trợ: {name}")
            if len(df) < min_rows:
                raise DataSourceError(f"chỉ có {len(df)} dòng < {min_rows}")
            got[name] = df
            log(f"[data] nguồn '{name}': {len(df)} dòng")
            if not merge:
                break
        except DataSourceError as e:
            errors[name] = str(e)
            log(f"[data] nguồn '{name}' không dùng được: {e}")
    if not got:
        raise DataSourceError(f"Mọi nguồn đều thất bại: {errors}")
    df = pd.concat(got.values(), ignore_index=True).drop_duplicates("push_id").sort_values("push_id").reset_index(drop=True)
    return df, {"used": list(got), "errors": errors, "rows": len(df)}
