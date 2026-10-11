"""Kiểm thử nguồn dữ liệu CSV + Firebase (dùng server HTTP giả lập Firebase REST, không cần mạng).
Chạy: python -m unittest discover -s tests -v   (trong thư mục ai_model/)
"""
import json, sys, threading, unittest, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import data_source as ds  # noqa: E402

CSV_TEXT = "﻿gas,humi,temp,timestamp,push_id\n100,50,30.0,22:00:00,-Ov0000000000000000A\n200,51,30.1,22:00:10,-Ov0000000000000000B\n"
DB = {"-Ov0000000000000000B": {"gas": 200, "humi": 51, "temp": 30.1, "timestamp": "22:00:10"},   # trùng với CSV
      "-Ov0000000000000000C": {"gas": 300, "humi": 52, "temp": 30.2, "timestamp": "22:00:20"},
      "-Ov0000000000000000D": {"gas": 400, "humi": 53, "temp": 30.3, "timestamp": "22:00:30"}}


class FakeFirebase(BaseHTTPRequestHandler):
    mode = "ok"
    last_query = {}

    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        FakeFirebase.last_query = {"path": u.path, **{k: v[0] for k, v in q.items()}}
        if FakeFirebase.mode == "401":
            self.send_response(401); self.end_headers(); self.wfile.write(b'{"error":"Permission denied"}'); return
        body = json.dumps(None if FakeFirebase.mode == "empty" else DB).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)

    def log_message(self, *a):
        pass


class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), FakeFirebase)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.csv = self.tmp / "d.csv"; self.csv.write_text(CSV_TEXT, encoding="utf-8")
        self.cache = self.tmp / "cache.csv"
        FakeFirebase.mode = "ok"
        self.cfg = ds.FirebaseConfig(db_url=self.url, path="sensor_data", auth="TOKEN", limit=100, retries=1, timeout=2)
        self.q = lambda **k: ds.load(csv_path=self.csv, firebase=self.cfg, cache_path=self.cache, log=lambda *a: None, **k)

    def test_push_id_decoding(self):
        self.assertEqual(str(ds.push_id_to_datetime("-OuXWjtZX0g5Ncy9WLoQ"))[:10], "2026-06-07")

    def test_csv_primary(self):
        df, info = self.q(sources=("csv", "firebase"))
        self.assertEqual(info["used"], ["csv"]); self.assertEqual(len(df), 2)          # CSV đủ -> không gọi Firebase

    def test_firebase_read_and_query_params(self):
        df = ds.read_firebase(self.cfg)
        self.assertEqual(list(df.push_id), sorted(DB)); self.assertEqual(len(df), 3)
        q = FakeFirebase.last_query
        self.assertEqual(q["path"], "/sensor_data.json"); self.assertEqual(q["orderBy"], '"$key"')
        self.assertEqual(q["limitToLast"], "100"); self.assertEqual(q["auth"], "TOKEN")

    def test_fallback_csv_missing_to_firebase_and_cache(self):
        self.csv.unlink()
        df, info = self.q(sources=("csv", "firebase"))
        self.assertEqual(info["used"], ["firebase"]); self.assertIn("csv", info["errors"]); self.assertEqual(len(df), 3)
        self.assertTrue(self.cache.exists())                                           # đã lưu đệm

    def test_fallback_not_enough_rows(self):
        df, info = self.q(sources=("csv", "firebase"), min_rows=3)
        self.assertEqual(info["used"], ["firebase"])

    def test_firebase_down_uses_cache(self):
        self.csv.unlink(); self.q(sources=("firebase",))                                # nạp cache
        FakeFirebase.mode = "401"
        df, info = self.q(sources=("firebase", "firebase_cache"))
        self.assertEqual(info["used"], ["firebase_cache"]); self.assertIn("401", info["errors"]["firebase"])

    def test_auth_error_and_empty(self):
        FakeFirebase.mode = "401"
        with self.assertRaises(ds.DataSourceError): ds.read_firebase(self.cfg)
        FakeFirebase.mode = "empty"
        with self.assertRaises(ds.DataSourceError): ds.read_firebase(self.cfg)

    def test_unreachable_server(self):
        bad = ds.FirebaseConfig(db_url="http://127.0.0.1:9", retries=1, timeout=1)
        with self.assertRaises(ds.DataSourceError): ds.read_firebase(bad)

    def test_merge_dedupes_by_push_id(self):
        df, info = self.q(sources=("csv", "firebase"), merge=True)
        self.assertEqual(info["used"], ["csv", "firebase"]); self.assertEqual(len(df), 4)   # A,B,C,D (B trùng)

    def test_all_sources_fail(self):
        self.csv.unlink(); self.cfg.db_url = ""
        with self.assertRaises(ds.DataSourceError): self.q(sources=("csv", "firebase"))

    def test_no_config_not_configured(self):
        self.assertFalse(ds.FirebaseConfig(db_url="").configured)


if __name__ == "__main__":
    unittest.main()
