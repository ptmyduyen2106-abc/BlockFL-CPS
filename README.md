# BlockFL-CPS — Federated Learning × Blockchain (Đề tài 3)

Học phần *Cơ sở Blockchain và Ứng dụng* · Hệ thống CPS 3 tầng: **IoT/Edge (ESP32) → AI (FedAvg, Raspberry Pi 5) → Smart Contract (Sepolia)**.

```
 ESP32 + BME280/MQ135 ──MQTT──► RPi5: FedAvg (TF/Keras) ──hash(Δw)──► FLManager.sol ──mint──► RewardToken (BFL)
        (Trí)                          (Hùng)             bridge/        (Duyên)                     │
                                                                                    Next.js Dashboard + MetaMask + Etherscan
```

## Cấu trúc
| Thư mục | Nội dung | Phụ trách |
|---|---|---|
| `contracts/` | `FLManager.sol`, `RewardToken.sol` (ERC-20), `SensorOracle.sol` (Chainlink, tùy chọn), `mocks/` (chỉ test) | Duyên |
| `test/` | 25 unit test Hardhat (coverage dòng ~99%) | Duyên |
| `scripts/` | `deploy.js` (local/Sepolia + verify Etherscan), `make_sample_round.js` | Duyên |
| `bridge/` | `fl_bridge.js` (Ethers.js), `fl_bridge.py` (Web3.py) — gửi hash(Δw) on-chain | Duyên |
| `dashboard/` | Next.js + Tailwind + MetaMask: FL monitor, bảng node, lịch sử TX, link Etherscan | Duyên |
| `ai_model/`, `iot_code/` | Mã AI & IoT (giao diện dữ liệu xem README trong từng thư mục) | Hùng / Trí |

## Chạy nhanh (local)
```bash
npm install
npx hardhat test                                   # 25 test phải pass
npx hardhat node                                   # terminal 1: chain local (chainId 31337)
npx hardhat run scripts/deploy.js --network localhost      # terminal 2
node scripts/make_sample_round.js 1                # dữ liệu mẫu (thay bằng đầu ra của Hùng)
node bridge/fl_bridge.js --network localhost --round 1 --start --finalize
cd dashboard && npm install && npm run dev         # http://localhost:3000
```
MetaMask: thêm mạng `http://127.0.0.1:8545` (chainId 31337) — dashboard tự gợi ý chuyển/ thêm mạng.
Import một khóa Hardhat public (chỉ local) để có ETH test.

## Deploy lên Sepolia + xác minh Etherscan
1. `cp .env.example .env` rồi điền `SEPOLIA_RPC_URL` (Alchemy/Infura), `DEPLOYER_PRIVATE_KEY` (**ví test**), `ETHERSCAN_API_KEY`.
2. Lấy Sepolia ETH từ faucet (Alchemy / Google Cloud Web3 faucet).
3. `npx hardhat run scripts/deploy.js --network sepolia` → tự cấp `MINTER_ROLE`, ghi `deployments/sepolia.json`, ABI + địa chỉ vào `dashboard/src/contracts/`, rồi verify.
4. Verify thủ công nếu cần: `npx hardhat verify --network sepolia <RewardToken> <deployer> 100000000000000000000000000` và `npx hardhat verify --network sepolia <FLManager> <RewardToken> <deployer>`.
5. Dashboard: `NEXT_PUBLIC_DEFAULT_CHAIN_ID=11155111` (trong `dashboard/.env.local`) → mọi TX/địa chỉ có link `sepolia.etherscan.io`.
6. Bridge trên Sepolia: đặt `NODE_PRIVATE_KEYS=k0,k1,k2` (mỗi node một ví có ít ETH gas) rồi `node bridge/fl_bridge.js --network sepolia --round 1 --start --finalize`.

## Thiết kế hợp đồng (tóm tắt)
- **Không lưu trọng số on-chain** (quá đắt). Mỗi node gửi `hash(Δw)` (keccak256), CID IPFS (tùy chọn), `numSamples`, `loss`, `accuracy`.
- `finalizeRound()` (owner/aggregator): tính **FedAvg có trọng số** cho loss/accuracy (`Σ nᵢ·xᵢ / Σ nᵢ`), tạo **cam kết global model**
  `keccak256(prevGlobalHash ‖ roundId ‖ (hashᵢ ‖ nᵢ)…)` (nối chuỗi giữa các vòng, tái tạo được off-chain) và **mint thưởng** `pool·nᵢ/N`.
- Yêu cầu tối thiểu `minUpdates` (mặc định 3 node) trước khi chốt vòng.
- `SensorOracle` (tùy chọn): Chainlink `ChainlinkClient` gọi HTTP GET tới API trên RPi5; `FLManager` chỉ nhận update của node đã được oracle xác thực
  (`setSensorOracle`). Có `setManualVerification` làm phương án dự phòng khi demo không có Chainlink node.

## Giới hạn đã biết
- Hardhat tải compiler `solc` từ mạng; `hardhat.config.js` tự dùng gói npm `solc@0.8.24` nên build được cả khi mạng bị chặn.
- Aggregator là một địa chỉ owner (tập trung hóa bước tổng hợp) — phù hợp phạm vi đồ án; hướng mở rộng: multisig / commit–reveal.
- Dashboard dùng EIP-1193 `window.ethereum` (MetaMask extension) + Ethers.js; chưa dùng `@metamask/sdk` (kết nối mobile qua QR).
