import addresses from "@/contracts/addresses.json";

export const CHAINS = {
  31337: {
    id: 31337, name: "Hardhat Local", hex: "0x7a69",
    rpc: "http://127.0.0.1:8545", explorer: null,
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  11155111: {
    id: 11155111, name: "Sepolia Testnet", hex: "0xaa36a7",
    rpc: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io",
    currency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  },
};

export const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID || 31337);
export const deploymentOf = (chainId) => addresses[String(chainId)] || null;

// Link Etherscan cho từng sự kiện on-chain (null nếu mạng local không có explorer)
export const txUrl = (chainId, hash) => (CHAINS[chainId]?.explorer ? `${CHAINS[chainId].explorer}/tx/${hash}` : null);
export const addrUrl = (chainId, a) => (CHAINS[chainId]?.explorer ? `${CHAINS[chainId].explorer}/address/${a}` : null);
export const blockUrl = (chainId, n) => (CHAINS[chainId]?.explorer ? `${CHAINS[chainId].explorer}/block/${n}` : null);
