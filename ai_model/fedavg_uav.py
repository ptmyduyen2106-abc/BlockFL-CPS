"""FedAvg thật trên dữ liệu cảm biến ESP32 (MQ135 + nhiệt/ẩm) - 3 edge node mô phỏng theo phiên đo.

Bài toán: dự đoán cảnh báo khí (gas >= phân vị 75 của dữ liệu hợp lệ, ADC 12-bit) ở thời điểm t từ
[temp, humi, gas(t-1), gas(t-2)] (chuẩn hóa cố định, không rò rỉ thống kê)  ->  MLP 4-16-8-1 (numpy thuần, ~ 0,4 nghìn tham số: hợp với ESP32).

Chạy:
    python fedavg_uav.py                       # nguồn: csv -> firebase (dự phòng)
    python fedavg_uav.py --source firebase     # chỉ Firebase (cần FIREBASE_DB_URL)
    python fedavg_uav.py --merge               # gộp CSV + Firebase, khử trùng theo push_id
Đầu ra:
    outputs/round_<n>/{round.json,node<i>_dw.bin}   <- bridge/fl_bridge.js đọc để gửi hash(Δw) on-chain
    results/{results.json,results.csv,fedavg_vs_baselines.png,data_report.json}
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import pandas as pd

import data_source
from data_cleaning import clean

HERE = Path(__file__).resolve().parent
SIZES = [4, 16, 8, 1]
N_NODES = 3
LOG_MAX = np.log1p(4095)      # gas chuẩn hóa log: log1p(gas)/log1p(4095) ∈ [0,1]


# ───────────────────────── MLP (numpy) ─────────────────────────
def init_params(rng, sizes=SIZES):
    ps = []
    for a, b in zip(sizes[:-1], sizes[1:]):
        ps += [rng.normal(0, np.sqrt(2 / a), (a, b)), np.zeros(b)]
    return ps


def flatten(ps):
    return np.concatenate([p.ravel() for p in ps]).astype(np.float32)


def unflatten(vec, sizes=SIZES):
    ps, i = [], 0
    for a, b in zip(sizes[:-1], sizes[1:]):
        ps.append(vec[i:i + a * b].reshape(a, b).astype(np.float64)); i += a * b
        ps.append(vec[i:i + b].astype(np.float64)); i += b
    return ps


def forward(ps, X):
    acts, h = [X], X
    for k in range(0, len(ps) - 2, 2):
        h = np.maximum(0, h @ ps[k] + ps[k + 1]); acts.append(h)
    z = h @ ps[-2] + ps[-1]
    return acts, 1 / (1 + np.exp(-np.clip(z, -30, 30)))


def bce(p, y, w=None):
    p = np.clip(p, 1e-7, 1 - 1e-7)
    l = -(y * np.log(p) + (1 - y) * np.log(1 - p))
    return float(np.mean(l if w is None else l * w))


def train_local(ps, X, y, epochs, lr, batch, pos_w, rng):
    ps = [p.copy() for p in ps]
    n = len(X)
    for _ in range(epochs):
        idx = rng.permutation(n)
        for s in range(0, n, batch):
            b = idx[s:s + batch]
            xb, yb = X[b], y[b][:, None]
            acts, p = forward(ps, xb)
            w = np.where(yb == 1, pos_w, 1.0)
            dz = (p - yb) * w / len(b)
            grads = [None] * len(ps)
            for k in range(len(ps) - 2, -1, -2):
                a = acts[k // 2]
                grads[k], grads[k + 1] = a.T @ dz, dz.sum(0)
                if k > 0:
                    dz = (dz @ ps[k].T) * (acts[k // 2] > 0)
            ps = [p_ - lr * g for p_, g in zip(ps, grads)]
    return ps


def metrics(ps, X, y):
    _, p = forward(ps, X)
    pred = (p[:, 0] >= 0.5).astype(int)
    tp = int(((pred == 1) & (y == 1)).sum()); fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum()); tn = int(((pred == 0) & (y == 0)).sum())
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {"loss": bce(p, y[:, None]), "acc": (tp + tn) / len(y), "precision": prec, "recall": rec, "f1": f1,
            "tp": tp, "fp": fp, "fn": fn, "tn": tn}


# ───────────────────────── Dữ liệu ─────────────────────────
def build_features(df):
    rows = []
    for _, g in df.groupby("session"):
        g = g.reset_index(drop=True)
        if len(g) < 3:
            continue
        X = np.column_stack([(g.temp - 30) / 5, (g.humi - 55) / 10, np.log1p(g.gas.shift(1)) / LOG_MAX, np.log1p(g.gas.shift(2)) / LOG_MAX])[2:]
        rows.append((X, g.alert.values[2:], np.full(len(X), g.session[0]), (np.arange(len(X)) >= int(len(X) * 0.7))))
    X = np.vstack([r[0] for r in rows]); y = np.concatenate([r[1] for r in rows]); s = np.concatenate([r[2] for r in rows])
    is_test = np.concatenate([r[3] for r in rows])        # 30% cuối MỖI phiên đo làm tập test (tách theo thời gian)
    return X.astype(np.float64), y.astype(int), s, is_test


def split_nodes(session_ids, n_nodes=N_NODES):
    """Chia các phiên đo (liên tiếp theo thời gian) thành n_nodes nhóm có số mẫu gần bằng nhau."""
    sess, counts = np.unique(session_ids, return_counts=True)
    target, groups, cur, acc = counts.sum() / n_nodes, [], [], 0
    for s, c in zip(sess, counts):
        cur.append(s); acc += c
        if acc >= target and len(groups) < n_nodes - 1:
            groups.append(cur); cur, acc = [], 0
    groups.append(cur)
    return groups


def run_once(nodes, Xte, yte, Xtr, ytr, gpos_w, thr, rounds, epochs, lr, seed, out_dir=None):
    """Một lần chạy đầy đủ: FedAvg + các baseline cùng ngân sách epoch. out_dir != None -> ghi Δw từng vòng."""
    rng = np.random.default_rng(seed)
    w = init_params(rng)
    curve = []
    if out_dir is not None:
        for d in out_dir.glob("round_*"):
            shutil.rmtree(d)
    for r in range(1, rounds + 1):
        gvec = flatten(w)
        locals_, reports = [], []
        manifest = {"round": r, "nodes": []}
        if out_dir is not None:
            rd = out_dir / f"round_{r}"; rd.mkdir(parents=True, exist_ok=True)
        for i, n in enumerate(nodes):
            lp = train_local(w, n["Xtr"], n["ytr"], epochs, lr, 16, n["pos_w"], rng)
            mt = metrics(lp, n["Xte"], n["yte"])
            if out_dir is not None:
                fn = f"node{i + 1}_dw.bin"; (rd / fn).write_bytes((flatten(lp) - gvec).tobytes())
                manifest["nodes"].append({"nodeIndex": i, "weightsFile": fn, "numSamples": int(len(n["Xtr"])),
                                           "loss": round(mt["loss"], 4), "accuracy": round(mt["acc"], 4)})
            locals_.append((lp, len(n["Xtr"]))); reports.append(mt)
        if out_dir is not None:
            (rd / "round.json").write_text(json.dumps(manifest, indent=2))
        tot = sum(c for _, c in locals_)
        w = [sum(p[k] * c for p, c in locals_) / tot for k in range(len(w))]       # FedAvg: Σ nᵢ·wᵢ / N
        g = metrics(w, Xte, yte)
        curve.append({"round": r, **{f"global_{k}": v for k, v in g.items() if k in ("loss", "acc", "precision", "recall", "f1")},
                      "node_loss_avg": float(np.average([m["loss"] for m in reports], weights=[c for _, c in locals_])),
                      "node_acc_avg": float(np.average([m["acc"] for m in reports], weights=[c for _, c in locals_]))})
    final = metrics(w, Xte, yte)
    te = rounds * epochs
    cen = train_local(init_params(np.random.default_rng(seed)), Xtr, ytr, te, lr, 16, gpos_w, np.random.default_rng(seed))
    base = {"centralized": metrics(cen, Xte, yte)}
    for i, n in enumerate(nodes):
        lp = train_local(init_params(np.random.default_rng(seed)), n["Xtr"], n["ytr"], te, lr, 16, n["pos_w"], np.random.default_rng(seed))
        base[f"local_only_node{i + 1}"] = metrics(lp, Xte, yte)
    return w, curve, final, base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="auto", choices=["auto", "csv", "firebase"])
    ap.add_argument("--merge", action="store_true", help="gộp CSV + Firebase (khử trùng theo push_id)")
    ap.add_argument("--csv", default=str(data_source.DEFAULT_CSV))
    ap.add_argument("--rounds", type=int, default=15)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=42, help="seed cho các file outputs/round_*")
    ap.add_argument("--seeds", type=int, default=10, help="số seed để lấy trung bình ± độ lệch chuẩn")
    ap.add_argument("--alert-percentile", type=float, default=75.0)
    a = ap.parse_args()

    chain = {"auto": ("csv", "firebase", "firebase_cache"), "csv": ("csv",), "firebase": ("firebase", "firebase_cache")}[a.source]
    raw, info = data_source.load(chain, csv_path=a.csv, merge=a.merge, min_rows=10)
    df, stats = clean(raw, a.alert_percentile)
    thr = stats["alert_threshold_gas"]
    stats["data_source"] = info
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "data_report.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False))
    print(f"Dữ liệu: {stats['rows_total']} dòng -> {stats['rows_valid']} hợp lệ, {stats['sessions']} phiên, {stats['alert_rows']} dòng cảnh báo (gas >= {thr:g})")

    X, y, sess, is_test = build_features(df)
    groups = split_nodes(sess)
    nodes = []
    for i, g in enumerate(groups):
        m = np.isin(sess, g); tr, te = m & ~is_test, m & is_test
        nodes.append({"Xtr": X[tr], "ytr": y[tr], "Xte": X[te], "yte": y[te], "sessions": [int(s) for s in g]})
        print(f"  node{i + 1}: phiên {[int(s) for s in g]}, train={tr.sum()}, test={te.sum()}, cảnh báo(train/test)={y[tr].sum()}/{y[te].sum()}")
    Xte = np.vstack([n["Xte"] for n in nodes]); yte = np.concatenate([n["yte"] for n in nodes])
    Xtr = np.vstack([n["Xtr"] for n in nodes]); ytr = np.concatenate([n["ytr"] for n in nodes])
    for n in nodes:
        pos = n["ytr"].sum()
        n["pos_w"] = float(np.clip((len(n["ytr"]) - pos) / pos, 1, 10)) if pos else 1.0
    gpos = ytr.sum(); gpos_w = float(np.clip((len(ytr) - gpos) / gpos, 1, 10))

    # ── Lần chạy chính (ghi outputs/round_* cho bridge) ──
    w, curve, final, base = run_once(nodes, Xte, yte, Xtr, ytr, gpos_w, thr, a.rounds, a.epochs, a.lr, a.seed, HERE / "outputs")
    for c in curve:
        print(f"  vòng {c['round']:2d}: global loss={c['global_loss']:.4f} acc={c['global_acc']:.3f} P={c['global_precision']:.2f} R={c['global_recall']:.2f} F1={c['global_f1']:.2f}")

    pers = (np.expm1(Xte[:, 2] * LOG_MAX) >= thr - 0.5).astype(int)      # luật: cảnh báo nếu gas(t-1) >= ngưỡng
    tp = int(((pers == 1) & (yte == 1)).sum()); fp = int(((pers == 1) & (yte == 0)).sum()); fn = int(((pers == 0) & (yte == 1)).sum())
    pr = tp / (tp + fp) if tp + fp else 0.0; rc = tp / (tp + fn) if tp + fn else 0.0
    base["persistence_rule"] = {"acc": float((pers == yte).mean()), "precision": pr, "recall": rc, "f1": 2 * pr * rc / (pr + rc) if pr + rc else 0.0}
    base["majority_class"] = {"acc": float((yte == 0).mean()), "precision": 0.0, "recall": 0.0, "f1": 0.0}

    # ── Nhiều seed -> trung bình ± độ lệch chuẩn (tập test nhỏ nên 1 seed rất nhiễu) ──
    agg = {}
    for s in range(a.seeds):
        _, _, fin, bs = run_once(nodes, Xte, yte, Xtr, ytr, gpos_w, thr, a.rounds, a.epochs, a.lr, 1000 + s)
        for name, m in {"fedavg": fin, "centralized": bs["centralized"],
                        "local_only_mean": {k: float(np.mean([bs[f"local_only_node{i + 1}"][k] for i in range(N_NODES)])) for k in ("loss", "acc", "precision", "recall", "f1")}}.items():
            for k in ("loss", "acc", "precision", "recall", "f1"):
                agg.setdefault(name, {}).setdefault(k, []).append(m[k])
    multi = {n: {k: {"mean": float(np.mean(v)), "std": float(np.std(v))} for k, v in d.items()} for n, d in agg.items()}

    np.savez(HERE / "results" / "global_model.npz", *w)
    res = {"config": {"rounds": a.rounds, "local_epochs": a.epochs, "lr": a.lr, "seed": a.seed, "n_seeds": a.seeds, "model": "MLP 4-16-8-1", "params": int(flatten(w).size),
                      "alert_gas_threshold": thr, "alert_percentile": a.alert_percentile,
                      "features": ["(temp-30)/5", "(humi-55)/10", "log1p(gas(t-1))/log1p(4095)", "log1p(gas(t-2))/log1p(4095)"]},
           "nodes": [{"node": i + 1, "sessions": n["sessions"], "n_train": int(len(n["Xtr"])), "n_test": int(len(n["Xte"])),
                      "alerts_train": int(n["ytr"].sum()), "alerts_test": int(n["yte"].sum()), "pos_weight": n["pos_w"]} for i, n in enumerate(nodes)],
           "global_test": {"n": int(len(yte)), "alerts": int(yte.sum())},
           "fedavg_final_seed": final, "baselines_seed": base, "multi_seed": multi, "curve": curve}
    (HERE / "results" / "results.json").write_text(json.dumps(res, indent=2))
    pd.DataFrame(curve).to_csv(HERE / "results" / "results.csv", index=False)

    try:
        import matplotlib; matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(1, 2, figsize=(10, 3.6))
        rs = [c["round"] for c in curve]
        ax[0].plot(rs, [c["global_loss"] for c in curve], "o-", color="#d97706", label="FedAvg (global)")
        ax[0].axhline(base["centralized"]["loss"], ls="--", color="#2563eb", label="Tập trung")
        ax[0].set_title("Loss trên tập test chung"); ax[0].set_xlabel("Vòng FL"); ax[0].legend()
        ax[1].plot(rs, [c["global_f1"] for c in curve], "o-", color="#059669", label="FedAvg (F1)")
        ax[1].axhline(base["centralized"]["f1"], ls="--", color="#2563eb", label="Tập trung")
        ax[1].axhline(base["persistence_rule"]["f1"], ls=":", color="#6b7280", label="Luật gas(t-1)≥ngưỡng")
        ax[1].set_title("F1 lớp cảnh báo"); ax[1].set_xlabel("Vòng FL"); ax[1].set_ylim(0, 1.05); ax[1].legend(fontsize=8)
        fig.tight_layout(); fig.savefig(HERE / "results" / "fedavg_vs_baselines.png", dpi=150)
    except Exception as e:                                           # matplotlib không bắt buộc
        print("(bỏ qua vẽ biểu đồ:", e, ")")
    print(f"\nTrung bình {a.seeds} seed (± std):")
    for n, d in multi.items():
        print(f"  {n:16s} " + "  ".join(f"{k}={v['mean']:.3f}±{v['std']:.3f}" for k, v in d.items()))
    print("  persistence_rule  " + "  ".join(f"{k}={base['persistence_rule'][k]:.3f}" for k in ("acc", "precision", "recall", "f1")) + "  (tất định)")


if __name__ == "__main__":
    main()
