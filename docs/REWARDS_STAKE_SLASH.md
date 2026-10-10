# Cơ chế thưởng hiện tại và đề xuất stake / slash

## 1. Hiện tại (đã chạy trên Sepolia)
`FLManager.finalizeRound()` chia quỹ thưởng theo số mẫu node tự khai: `reward_i = pool × n_i / N`, `N = Σ n_j`, làm tròn xuống, phát `RewardPaid(roundId, node, amount)` và mint BFL qua `RewardToken`.

Ví dụ vòng 1 (pool 300 BFL, n = 520/640/760, N = 1920): 81,25 / 100,00 / 118,75 BFL. Bằng chứng: trang **Thưởng** của dashboard (bảng sự kiện `RewardPaid` có TX, đối soát Σ RewardPaid = tổng cung).

## 2. Hạn chế (nêu trong báo cáo)
1. `n_i` tự khai, contract không kiểm chứng → node có thể khai khống để ăn phần lớn quỹ.
2. Không có chi phí khi gian lận (gửi hash rác, Δw độc hại, Sybil nhiều ví).
3. Thưởng không phản ánh chất lượng (loss/độ lệch so với các node khác).
4. BFL chỉ mint, chưa có nơi tiêu.

Ví dụ khai khống: node 3 khai 7600 thay vì 760 → nhận 260,27 BFL (87%), hai node còn lại chỉ 17,81 và 21,92.

## 3. Đề xuất (CHƯA triển khai — cần deploy và verify lại contract)
**Stake.** `registerNode()` thành `payable`, yêu cầu `msg.value ≥ MIN_STAKE` (đề xuất 0,005 ETH Sepolia; dùng ETH để tránh vòng luẩn quẩn "chưa có BFL để cọc"). Rút cọc qua `requestUnstake()` + chờ `UNBONDING = 2 vòng`, để không rút trước khi bị phát hiện gian lận.

**Slash.** Hàm `slash(node, bps, reason)` chỉ `owner` (giả định tin cậy, giống bước `finalizeRound`) gọi, kèm bằng chứng băm đã công bố off-chain:

| Vi phạm | Cách phát hiện | Mức phạt (% cọc) |
|---|---|---|
| `deltaHash` không khớp Δw tải từ CID | Aggregator băm lại file | 20% |
| Δw lệch bất thường (‖Δw_i − median‖ / ‖median‖ > τ) | Aggregator off-chain (Hùng) | 20% |
| `numSamples` lệch số mẫu đã được oracle xác thực | `SensorOracle` / RPi5 | 50% |
| Lặp lại vi phạm | đếm `strikes[node]` | 100% + `setNodeActive(false)` |
| Vắng mặt liên tiếp ≥ 3 vòng | đếm vòng không gửi | 5% |

Tiền phạt: 50% đốt, 50% chia cho node trung thực của vòng theo `n_i`.

**Thưởng theo chất lượng và chặn khai khống:**

```
n_eff_i = min(n_i, 2 × median(n))            // chặn khai khống
q_i     = 1                       nếu d_i ≤ τ
        = max(0, 1 − (d_i − τ)/τ) nếu d_i > τ   // d_i = độ lệch Δw so với median
reward_i = pool × (n_eff_i × q_i) / Σ_j (n_eff_j × q_j)
```
`q_i` do aggregator tính off-chain và công bố cùng bằng chứng băm (giả định tin cậy, nêu rõ trong báo cáo).

Hiệu quả trên ví dụ khai khống (pool 300 BFL):

| Kịch bản | Node 1 | Node 2 | Node 3 (gian lận) |
|---|---|---|---|
| Hiện tại (n3 = 7600) | 17,81 | 21,92 | 260,27 |
| Chặn n_eff ≤ 2×median (1280) | 63,93 | 78,69 | 157,38 |
| Thêm q3 = 0,2 (bị đánh dấu lệch) | 110,17 | 135,59 | 54,24 |

Phác thảo (không biên dịch/kiểm thử):
```solidity
mapping(address => uint256) public stake;
function registerNode(string calldata m) external payable { require(msg.value >= MIN_STAKE, "stake"); stake[msg.sender] = msg.value; /* ... */ }
function slash(address n, uint16 bps, bytes32 evidence) external onlyOwner {
    uint256 cut = stake[n] * bps / 10_000; stake[n] -= cut; /* 50% burn, 50% pool trung thực */
    emit Slashed(n, cut, evidence);
}
```

## 4. Khuyến nghị thực hiện
Đưa mục 2–3 vào báo cáo như **hạn chế và hướng phát triển** (có số liệu ví dụ ở trên). Chỉ viết contract V2 nếu còn thời gian sau khi ghép báo cáo: V2 phải viết thêm test (cọc, slash, unbonding, trường hợp biên), deploy và verify lại trên Sepolia, và dashboard cần đổi địa chỉ/ABI.
