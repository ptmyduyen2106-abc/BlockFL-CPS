# Dữ liệu cảm biến (`data/raw/uav_filtered_data.csv`) — kiểm tra nguồn gốc và chất lượng

## Kết luận
**Các bản ghi là dữ liệu đo thật từ thiết bị, nhưng file đã bị xử lý sau khi xuất, không dùng nguyên trạng được.**

| Kiểm tra | Kết quả |
|---|---|
| Nguồn | Xuất từ Firebase Realtime Database: `push_id` kiểu `-Oxxxx…` (Firebase push ID), 1544/1544 duy nhất, tăng dần |
| Thời gian thật (giải mã 8 ký tự đầu của `push_id`, giờ VN) | 07/06/2026 21:40 → 10/10/2026 18:42, khớp với các lần thu thập rời rạc (07/06, 13/06, 23/06, 26–27/06, 01–12/07, 09–10/10) |
| Cột `timestamp`, 935 dòng đầu | **Bị ghi đè**: chỉ có 2 giá trị `21:35:00` (699 dòng) và `22:00:00` (236 dòng); 0/935 dòng khớp thời gian push thật (lệch từ 5 phút đến ~5,5 ngày) |
| Cột `timestamp`, 609 dòng sau | Chỉ có giờ, **mất ngày**; 592/609 khớp thời gian push thật (±2 giây); 17 dòng lệch do đồng hồ ESP32 chưa đồng bộ (vd `07:00:07`, `07:01:01`, `07:02:02` giống giá trị mặc định sau reset) |
| Lỗi cảm biến | DHT: 1088/1544 dòng (70,5%) có `humi=0` (1083 dòng `temp=humi=0`) = đọc lỗi. MQ (`gas`): 489 dòng bằng 0, 21 dòng bão hoà 4095 (ADC 12-bit) |
| Giá trị dùng được | 456 dòng DHT hợp lệ (temp 25,6–34,1 °C, humi 34–67 %); 183 dòng có cả `gas` hợp lệ |
| Nhãn | **Không có cột nhãn** (AQI/mức an toàn) — cần định nghĩa nhãn trước khi huấn luyện có giám sát |

Cách khôi phục thời gian: `scripts/prepare_dataset.py` lấy giờ từ `push_id` thay cho cột `timestamp`.

```bash
python3 scripts/prepare_dataset.py        # data/raw/... → data/uav_clean.csv (456 dòng, có cột gas_valid)
```

## Hệ quả cho báo cáo
- **Vòng 1 trên Sepolia dùng dữ liệu mẫu, không phải dữ liệu từ file này**: `scripts/make_sample_round.js` sinh Δw ngẫu nhiên, `numSamples = 400 + 120·i` (520/640/760, tổng 1920), loss/accuracy theo công thức. Tổng 1920 mẫu còn lớn hơn toàn bộ dữ liệu sạch (456), nên không thể suy ra từ file này. Giao dịch on-chain là thật; nội dung cập nhật là mô phỏng — báo cáo phải ghi rõ.
- Muốn có thực nghiệm FL thật: chia `uav_clean.csv` cho 3 node (theo ngày thu thập để có phân phối khác nhau), huấn luyện, rồi đưa `numSamples`, loss, accuracy **thật** vào `round.json`. 456 mẫu là rất ít → nên thu thêm dữ liệu (xem mục dưới) trước hạn.
- Đừng dùng file này làm bằng chứng "dữ liệu thật" mà không nêu 70% dòng bị loại và cột `timestamp` đã bị ghi đè.

## Cơ chế dự phòng lấy dữ liệu từ Firebase
Đường chính: ESP32 → MQTT → RPi5. Đường dự phòng: ESP32 → Firebase RTDB → `iot_code/firebase_pull.py`.

```bash
export FIREBASE_DB_URL="https://<project>-default-rtdb.<region>.firebasedatabase.app"
export FIREBASE_AUTH="<database secret hoặc ID token>"     # bỏ trống nếu rules cho đọc
python3 iot_code/firebase_pull.py --path <đường dẫn node chứa bản ghi> --once
python3 iot_code/firebase_pull.py --path <...> --interval 30   # chạy nền
```
- Chỉ dùng thư viện chuẩn Python; phân trang theo `$key`, nhớ push ID cuối trong `data/firebase_state.json` nên chạy lại chỉ lấy bản ghi mới.
- Áp dụng cùng luật làm sạch với `prepare_dataset.py`; ghi vào `data/firebase_live.csv`.
- Đã kiểm thử với máy chủ giả lập REST của RTDB dựng từ chính file CSV: kết quả giống hệt `uav_clean.csv` (456 dòng), lần chạy thứ hai lấy thêm 0 dòng. **Chưa chạy với Firebase thật** (cần URL và `--path` đúng của dự án). Không commit URL/khoá vào repo.
