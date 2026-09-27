"""
data_simulator.py — Giả lập dữ liệu ESP32 khi phần cứng lỗi
Gửi dữ liệu cảm biến giả lên MQTT broker mỗi 2 giây
Dùng làm phương án dự phòng trong demo live
"""

import json, time, random
import paho.mqtt.client as mqtt

BROKER  = "localhost"
PORT    = 1883
TOPIC   = "blockfl/sensors"
NODE_ID = "simulator_node_01"

def generate_sample(anomaly=False):
    if anomaly:
        return {
            "node_id":   NODE_ID,
            "timestamp": int(time.time()),
            "temp":      round(random.uniform(40, 50), 2),
            "humidity":  round(random.uniform(85, 99), 2),
            "co2_ppm":   round(random.uniform(2000, 5000), 1),
            "pressure":  round(random.uniform(980, 990), 2),
            "label":     1,  # anomaly
        }
    else:
        return {
            "node_id":   NODE_ID,
            "timestamp": int(time.time()),
            "temp":      round(random.uniform(22, 34), 2),
            "humidity":  round(random.uniform(45, 75), 2),
            "co2_ppm":   round(random.uniform(400, 900), 1),
            "pressure":  round(random.uniform(1010, 1025), 2),
            "label":     0,  # normal
        }

def main():
    client = mqtt.Client()
    client.connect(BROKER, PORT, 60)
    client.loop_start()

    print(f"[SIM] Bắt đầu giả lập → topic: {TOPIC}")
    print("[SIM] Ctrl+C để dừng\n")

    count = 0
    try:
        while True:
            # 15% xác suất anomaly
            is_anomaly = random.random() < 0.15
            payload    = generate_sample(anomaly=is_anomaly)
            client.publish(TOPIC, json.dumps(payload))
            status = "⚠️  ANOMALY" if is_anomaly else "✅ Normal"
            print(f"[{count:04d}] {status} | temp={payload['temp']} | co2={payload['co2_ppm']}")
            count += 1
            time.sleep(2)
    except KeyboardInterrupt:
        print("\n[SIM] Dừng simulator")
    finally:
        client.loop_stop()
        client.disconnect()

if __name__ == "__main__":
    main()
