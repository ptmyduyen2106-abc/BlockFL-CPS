/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cho phép mở dashboard (next dev) bằng IP mạng LAN, vd http://192.168.62.1:3000.
  // Next 16 mặc định chặn các file /_next/* từ origin khác localhost → trang kẹt ở "Đang tải…".
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*", "*.local"],
};
export default nextConfig;
