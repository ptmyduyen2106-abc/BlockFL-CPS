// Tạo dữ liệu mẫu cho bridge khi chưa có đầu ra thật từ AI (Hùng).
//   node scripts/make_sample_round.js 1
// Cấu trúc đầu ra (đây cũng là "hợp đồng giao diện" với phần AI):
//   ai_model/outputs/round_<n>/round.json        ← manifest
//   ai_model/outputs/round_<n>/node<i>_dw.bin    ← Δw (float32 little-endian)
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const round = Number(process.argv[2] || 1);
const dir = path.join(__dirname, "..", "ai_model", "outputs", `round_${round}`);
fs.mkdirSync(dir, { recursive: true });
const nodes = [];
for (let i = 1; i <= 3; i++) {
  const w = new Float32Array(1000).map(() => (Math.random() - 0.5) * 0.02);
  const f = `node${i}_dw.bin`;
  fs.writeFileSync(path.join(dir, f), Buffer.from(w.buffer));
  nodes.push({
    nodeIndex: i - 1,                       // vị trí signer / khóa trong NODE_PRIVATE_KEYS
    weightsFile: f,
    numSamples: 400 + i * 120,
    loss: +(0.9 / (round + i * 0.3)).toFixed(4),
    accuracy: +Math.min(0.98, 0.6 + round * 0.05 + i * 0.02).toFixed(4),
  });
}
fs.writeFileSync(path.join(dir, "round.json"), JSON.stringify({ round, nodes }, null, 2));
console.log("Đã tạo", dir);
