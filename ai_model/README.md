# ai_model/  (phụ trách: Hùng)
Chỗ đặt mã Python FedAvg. **Giao diện với blockchain** (bridge đọc thư mục này):

```
ai_model/outputs/round_<n>/round.json      # manifest
ai_model/outputs/round_<n>/node<i>_dw.bin  # Δw của node i (float32, little-endian)
```
`round.json`:
```json
{ "round": 1, "nodes": [
  { "nodeIndex": 0, "weightsFile": "node1_dw.bin", "numSamples": 520, "loss": 0.69, "accuracy": 0.67 } ] }
```
Sau mỗi round, script FedAvg ghi 2 thứ trên rồi chạy `node bridge/fl_bridge.js --round <n> --start --finalize`.
`round_1` hiện là **dữ liệu mẫu** do `scripts/make_sample_round.js` sinh ra.
