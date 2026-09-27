"""
quantize.py — Lượng tử hóa model INT8 → TensorFlow Lite
Sau đó nạp file .tflite lên ESP32 bằng TFLite Micro
"""

import numpy as np
import tensorflow as tf
from data_pipeline import generate_synthetic_data
from sklearn.preprocessing import StandardScaler
import os

def representative_dataset(n=200):
    """Dataset đại diện để calibrate INT8 quantization."""
    X, _ = generate_synthetic_data(n_samples=n)
    scaler = StandardScaler().fit(X)
    X_scaled = scaler.transform(X).astype(np.float32)
    for i in range(n):
        yield [X_scaled[i:i+1]]


def quantize_to_tflite(saved_model_path: str, output_path: str = "model_int8.tflite"):
    converter = tf.lite.TFLiteConverter.from_saved_model(saved_model_path)

    # Full INT8 quantization
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = representative_dataset
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type  = tf.int8
    converter.inference_output_type = tf.int8

    tflite_model = converter.convert()

    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else ".", exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(tflite_model)

    size_kb = len(tflite_model) / 1024
    print(f"✅ Saved: {output_path} ({size_kb:.1f} KB)")
    return output_path


def benchmark_tflite(tflite_path: str):
    """So sánh accuracy trước/sau quantization."""
    interpreter = tf.lite.Interpreter(model_path=tflite_path)
    interpreter.allocate_tensors()

    in_det  = interpreter.get_input_details()[0]
    out_det = interpreter.get_output_details()[0]

    X, y = generate_synthetic_data(n_samples=500)
    scaler = StandardScaler().fit(X)
    X_scaled = scaler.transform(X)

    scale, zero_point = in_det["quantization"]
    correct = 0
    for i in range(len(X_scaled)):
        x = X_scaled[i:i+1].astype(np.float32)
        if scale != 0:
            x_int8 = np.round(x / scale + zero_point).astype(np.int8)
        else:
            x_int8 = x.astype(np.int8)

        interpreter.set_tensor(in_det["index"], x_int8)
        interpreter.invoke()
        out = interpreter.get_tensor(out_det["index"])
        pred = np.argmax(out)
        if pred == y[i]:
            correct += 1

    acc = correct / len(X_scaled)
    print(f"TFLite INT8 Accuracy: {acc:.4f} ({correct}/{len(X_scaled)})")
    return acc


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_path", default="saved_model/blockfl_global")
    parser.add_argument("--output",     default="saved_model/model_int8.tflite")
    args = parser.parse_args()

    path = quantize_to_tflite(args.model_path, args.output)
    benchmark_tflite(path)
