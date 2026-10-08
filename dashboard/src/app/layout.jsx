import "./globals.css";
import WalletProvider from "@/components/WalletProvider";
import Shell from "@/components/Shell";

export const metadata = { title: "BlockFL Dashboard", description: "Giám sát Federated Learning on-chain: vòng FL, node, giao dịch, token thưởng" };

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <WalletProvider><Shell>{children}</Shell></WalletProvider>
      </body>
    </html>
  );
}
