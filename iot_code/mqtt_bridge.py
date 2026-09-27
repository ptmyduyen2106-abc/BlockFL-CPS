"""
mqtt_bridge.py — Chạy trên Raspberry Pi 5
Nhận dữ liệu MQTT từ ESP32 → lưu buffer → trigger local training
"""

import json, time, threading, collections
import paho.mqtt.client as mqtt
import numpy as np

BROKER     = "localhost"
PORT       = 1883
TOPIC      = "blockfl/sensors"
BUFFER_SIZE = 100   # thu thập đủ 100 sample thì train

data_buffer = collections.deque(maxlen=BUFFER_SIZE)
lock = threading.Lock()


def on_connect(client, userdata, flags, rc):
    print(f"[MQTT] Kết nối broker rc={rc}")
    client.subscribe(TOPIC)


def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
        features = [
            payload.get("temp", 0),
            payload.get("humidity", 0),
            payload.get("co2_ppm", 0),
            payload.get("pressure", 0),
        ]
        with lock:
            data_buffer.append(features)
        print(f"[DATA] node={payload.get('node_id')} | temp={features[0]:.1f} | hum={features[1]:.1f} | co2={features[2]:.0f}")

        if len(data_buffer) >= BUFFER_SIZE:
            threading.Thread(target=trigger_local_train, daemon=True).start()

    except Exception as e:
        print(f"[ERR] parse message: {e}")


def trigger_local_train():
    """Khi đủ dữ liệu → gọi FedAvg (subprocess hoặc import trực tiếp)."""
    with lock:
        data = list(data_buffer)
        data_buffer.clear()

    X = np.array(data, dtype=np.float32)
    print(f"[TRAIN] Bắt đầu local training với {len(X)} samples...")

    # Import và chạy FedAvg (có thể thay bằng subprocess nếu chạy độc lập)
    import sys; sys.path.insert(0, "../ai_model")
    try:
        from fedavg import run_federated_learning
        run_federated_learning(num_rounds=1, num_nodes=1)
    except Exception as e:
        print(f"[ERR] training: {e}")


def main():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(BROKER, PORT, 60)
    print(f"[MQTT Bridge] Lắng nghe topic: {TOPIC}")
    client.loop_forever()


if __name__ == "__main__":
    main()
