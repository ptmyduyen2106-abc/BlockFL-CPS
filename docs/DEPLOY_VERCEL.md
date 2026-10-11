# Deploy dashboard BlockFL lên Vercel (không lỗi)

Dashboard là app Next.js nằm trong thư mục `dashboard/` của repo (gốc repo là Hardhat). Build thử trên bản `origin/main` mới nhất: **thành công** (7 route: `/`, `/nodes`, `/rewards`, `/transactions`…).

## 1. Cấu hình project (Vercel → Settings)
| Mục | Giá trị |
|---|---|
| Root Directory | `dashboard`  (**bắt buộc** — nếu để trống, Vercel build ở thư mục gốc và lỗi/404) |
| Framework Preset | Next.js |
| Node.js Version | 20.x hoặc 22.x (Next 16 cần ≥ 20.9) |
| Install / Build Command | mặc định (`npm install` / `npm run build`) |
| Output Directory | để trống (mặc định `.next`) |

## 2. Biến môi trường (Settings → Environment Variables, tick cả Production + Preview)
| Biến | Giá trị |
|---|---|
| `NEXT_PUBLIC_DEFAULT_CHAIN_ID` | `11155111` |
| `NEXT_PUBLIC_SEPOLIA_RPC_URL` | RPC Sepolia riêng (Alchemy/Infura, nên giới hạn theo domain). Bỏ trống → dùng RPC công khai, dễ bị rate-limit |
| `NEXT_PUBLIC_FIREBASE_DB_URL` | URL gốc Firebase RTDB (bỏ trống → ẩn panel cảm biến) |
| `NEXT_PUBLIC_FIREBASE_PATH` | `uav_logs` (mặc định) |
| `NEXT_PUBLIC_USE_MOCK` | **Không đặt** (đặt `1` sẽ hiện dữ liệu mô phỏng) |

- `NEXT_PUBLIC_*` được nhúng vào JS **lúc build** → sửa biến xong phải **Redeploy** (Deployments → ⋯ → Redeploy, bỏ tick "Use existing Build Cache").
- Không đưa khóa riêng (`DEPLOYER_PRIVATE_KEY`, `NODE_PRIVATE_KEYS`) hay Etherscan key vào Vercel — dashboard chỉ **đọc** chain, không cần.
- Địa chỉ hợp đồng Sepolia lấy từ `dashboard/src/contracts/addresses.json` (đã commit) → phải còn trong repo.

## 3. Lỗi thường gặp
| Triệu chứng | Nguyên nhân → cách sửa |
|---|---|
| 404 NOT_FOUND / build lỗi `hardhat` | Chưa đặt Root Directory = `dashboard` |
| Trang hiện dữ liệu mô phỏng / banner vàng | Đang bật `NEXT_PUBLIC_USE_MOCK=1` → xóa biến, redeploy |
| Trang trống, "Đang tải…" mãi | RPC công khai bị giới hạn → đặt `NEXT_PUBLIC_SEPOLIA_RPC_URL`; hoặc sai `DEFAULT_CHAIN_ID` |
| Chọn mạng "Hardhat Local" | Chưa đặt `NEXT_PUBLIC_DEFAULT_CHAIN_ID=11155111` (mặc định là 31337) → redeploy |
| Panel Firebase không hiện | Thiếu `NEXT_PUBLIC_FIREBASE_DB_URL`, hoặc rules RTDB không cho đọc `/sensor`, `/uav_logs`, `/settings` |
| Sửa biến mà không đổi | Chưa Redeploy (biến build-time) |
| `Node.js version` / `engine` lỗi | Chọn Node 20+ trong Settings |
| Đăng ký node báo lỗi ví | Cần MetaMask trên mạng Sepolia và có Sepolia ETH; chỉ xem dữ liệu thì không cần kết nối ví |

## 4. Quy trình cập nhật
`git push origin main` → Vercel tự build lại. Kiểm tra trước ở máy: `cd dashboard && npm ci && npm run build`.
