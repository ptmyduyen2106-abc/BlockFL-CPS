import "./globals.css";
import WalletProvider from "@/components/WalletProvider";
import Shell from "@/components/Shell";

export const metadata = { title: "BlockFL Dashboard", description: "Giám sát Federated Learning on-chain: vòng FL, node, giao dịch, token thưởng" };

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;800&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
      </head>
      <body>
        <WalletProvider><Shell>{children}</Shell></WalletProvider>
      </body>
    </html>
  );
}
