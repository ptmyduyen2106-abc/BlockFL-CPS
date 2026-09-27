# 🔗 BlockFL — Federated Learning + Blockchain + IoT

> **Đồ án cuối kỳ** — Học phần: Cơ sở Blockchain và Ứng dụng  
> **GVHD:** Huỳnh Thế Thiện — **HCMUTE**  
> **Đề tài 3:** Học liên kết bảo mật dữ liệu cảm biến y tế / đô thị (BlockFL)

---

## 📐 Kiến trúc hệ thống

```
┌─────────────────────────────────────────────────────────────┐
│                     TẦNG IoT / EDGE NODE                    │
│  ESP32 + BME280/MQ135  ──MQTT──►  Raspberry Pi 5 (Gateway) │
└───────────────────────────────┬─────────────────────────────┘
                                │ dữ liệu cảm biến
┌───────────────────────────────▼─────────────────────────────┐
│                      TẦNG AI / FEDERATED LEARNING           │
│  Node 1 (RPi5)  ┐                                           │
│  Node 2 (PC)    ├─► FedAvg ──► Global Model ──► TFLite      │
│  Node 3 (Sim)   ┘             (INT8 → ESP32)                │
└───────────────────────────────┬─────────────────────────────┘
                                │ hash(∆w) + round_id
┌───────────────────────────────▼─────────────────────────────┐
│                    TẦNG BLOCKCHAIN                          │
│  FLManager.sol (điều phối FL)                               │
│  RewardToken.sol (ERC-20 token thưởng)                      │
│  Sepolia Testnet  ◄──►  Next.js Dashboard + MetaMask        │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Cấu trúc Repository

```
BlockFL-CPS/
├── contracts/              # Smart Contracts (Solidity)
│   ├── FLManager.sol       # Điều phối Federated Learning
│   ├── RewardToken.sol     # ERC-20 token thưởng
│   └── hardhat.config.js
├── ai_model/               # Federated Learning (Python)
│   ├── fedavg.py           # Thuật toán FedAvg
│   ├── model.py            # Kiến trúc MLP/1D-CNN
│   ├── data_pipeline.py    # Tiền xử lý dữ liệu
│   ├── quantize.py         # Lượng tử hóa INT8 → TFLite
│   └── requirements.txt
├── iot_code/               # ESP32 firmware + MQTT
│   ├── esp32_sensor/       # Arduino sketch ESP32
│   │   └── esp32_sensor.ino
│   ├── mqtt_bridge.py      # Raspberry Pi MQTT → AI pipeline
│   └── data_simulator.py   # Giả lập dữ liệu (fallback demo)
├── frontend/               # Next.js Dashboard
│   ├── pages/
│   ├── components/
│   └── package.json
├── docs/
│   └── Report_Nhom__.pdf   # Báo cáo kỹ thuật (nộp sau)
└── README.md
```

---

## ⚙️ Cài đặt & Chạy

### 1. Smart Contract

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test

# Deploy local
npx hardhat node
npx hardhat run scripts/deploy.js --network localhost

# Deploy Sepolia
npx hardhat run scripts/deploy.js --network sepolia
```

### 2. AI / Federated Learning

```bash
cd ai_model
pip install -r requirements.txt

# Chạy FedAvg với 3 node giả lập
python fedavg.py --rounds 10 --nodes 3

# Lượng tử hóa model → TFLite
python quantize.py --model_path saved_model/ --output model_int8.tflite
```

### 3. IoT (ESP32)

- Mở `iot_code/esp32_sensor/esp32_sensor.ino` bằng Arduino IDE
- Cài thư viện: `PubSubClient`, `Adafruit BME280`
- Điền `WIFI_SSID`, `WIFI_PASS`, `MQTT_BROKER` vào file
- Upload lên ESP32

```bash
# Chạy MQTT bridge trên Raspberry Pi
cd iot_code
python mqtt_bridge.py
```

### 4. Dashboard (Next.js)

```bash
cd frontend
npm install
npm run dev
# Mở http://localhost:3000
```

---

## 🔑 Biến môi trường

Tạo file `.env` trong thư mục `contracts/`:

```env
ALCHEMY_API_KEY=your_alchemy_key
PRIVATE_KEY=your_wallet_private_key
ETHERSCAN_API_KEY=your_etherscan_key
```

Tạo file `.env.local` trong thư mục `frontend/`:

```env
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
NEXT_PUBLIC_ALCHEMY_KEY=your_alchemy_key
```

---

## 🧪 Demo Live — Kịch bản

1. Khởi động ESP32 → đọc cảm biến → gửi MQTT
2. RPi5 nhận dữ liệu → chạy local training (FedAvg round 1)
3. Gửi `hash(∆w)` lên `FLManager.sol` trên Sepolia
4. Smart Contract tổng hợp → phân bổ RewardToken
5. Dashboard hiển thị realtime → MetaMask xác nhận TX
6. Xem TX hash trên Etherscan

> **Phương án dự phòng:** nếu ESP32 lỗi, chạy `python iot_code/data_simulator.py`

---

## 👥 Thành viên nhóm

| Vai trò | Họ tên | MSSV |
|---|---|---|
| Blockchain Lead | | |
| IoT Engineer | | |
| AI Engineer | | |
| Web3 UX Engineer | | |

---

## 📜 License

MIT License — HCMUTE 2026
