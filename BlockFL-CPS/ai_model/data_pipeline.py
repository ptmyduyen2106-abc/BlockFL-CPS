"""
data_pipeline.py — Tải, chuẩn hóa và chia dữ liệu cho các FL node
Hỗ trợ: dữ liệu giả lập (mặc định) hoặc UCI Air Quality dataset
"""

import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split


def generate_synthetic_data(n_samples=2000, n_features=4, anomaly_ratio=0.15, seed=42):
    """
    Tạo dữ liệu giả lập cảm biến môi trường:
    features: [temperature, humidity, pm25, co2]
    label: 0 = bình thường, 1 = bất thường
    """
    rng = np.random.RandomState(seed)
    n_anomaly = int(n_samples * anomaly_ratio)
    n_normal  = n_samples - n_anomaly

    # Dữ liệu bình thường: nhiệt độ 20-35°C, độ ẩm 40-80%, PM2.5 < 50, CO2 < 1000
    X_normal = np.column_stack([
        rng.uniform(20, 35, n_normal),   # temperature
        rng.uniform(40, 80, n_normal),   # humidity
        rng.uniform(5,  50, n_normal),   # pm25
        rng.uniform(400, 900, n_normal), # co2
    ])
    y_normal = np.zeros(n_normal, dtype=int)

    # Dữ liệu bất thường
    X_anomaly = np.column_stack([
        rng.uniform(38, 50, n_anomaly),
        rng.uniform(85, 100, n_anomaly),
        rng.uniform(150, 500, n_anomaly),
        rng.uniform(2000, 5000, n_anomaly),
    ])
    y_anomaly = np.ones(n_anomaly, dtype=int)

    X = np.vstack([X_normal, X_anomaly])
    y = np.hstack([y_normal, y_anomaly])

    # Shuffle
    idx = rng.permutation(len(y))
    return X[idx], y[idx]


def load_and_split(num_nodes=3, test_size=0.2, seed=42):
    """
    Tải dữ liệu và chia đều cho num_nodes (IID split).
    Returns: list of (X_train, y_train, X_test, y_test) cho mỗi node
    """
    X, y = generate_synthetic_data(n_samples=3000, seed=seed)

    scaler = StandardScaler()
    X = scaler.fit_transform(X)

    # Lưu scaler để dùng khi inference
    import pickle, os
    os.makedirs("saved_model", exist_ok=True)
    with open("saved_model/scaler.pkl", "wb") as f:
        pickle.dump(scaler, f)

    # Split tổng thể train/test
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=test_size, random_state=seed)

    # Chia đều cho các node
    n = len(X_tr) // num_nodes
    datasets = []
    for i in range(num_nodes):
        Xi = X_tr[i*n:(i+1)*n]
        yi = y_tr[i*n:(i+1)*n]
        datasets.append((Xi, yi, X_te, y_te))

    return datasets
