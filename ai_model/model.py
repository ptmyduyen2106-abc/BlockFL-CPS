"""
model.py — Kiến trúc MLP nhỏ cho phát hiện bất thường cảm biến
Dữ liệu: nhiệt độ, độ ẩm, PM2.5/CO2 (hoặc nhịp tim, SpO2)
"""

import tensorflow as tf
from tensorflow import keras

def build_model(input_dim: int = 4, num_classes: int = 2) -> keras.Model:
    """
    MLP 3 lớp — nhỏ gọn, phù hợp lượng tử hóa INT8 và nạp lên ESP32.
    input_dim  : số feature đầu vào (mặc định 4: temp, humidity, pm25, co2)
    num_classes: 2 = bình thường / bất thường
    """
    model = keras.Sequential([
        keras.layers.Input(shape=(input_dim,)),
        keras.layers.Dense(32, activation="relu"),
        keras.layers.BatchNormalization(),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(16, activation="relu"),
        keras.layers.Dense(num_classes, activation="softmax"),
    ], name="blockfl_mlp")
    return model


def compile_model(model: keras.Model) -> keras.Model:
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.001),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


if __name__ == "__main__":
    m = build_model()
    m.summary()
