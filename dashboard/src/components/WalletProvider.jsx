"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserProvider, formatEther } from "ethers";
import { CHAINS, DEFAULT_CHAIN_ID, deploymentOf } from "@/lib/chains";
import { tokenContract } from "@/lib/fl";

const Ctx = createContext(null);
export const useWallet = () => useContext(Ctx);

/** Kết nối MetaMask qua EIP-1193 (window.ethereum) + ethers BrowserProvider */
export default function WalletProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [walletChain, setWalletChain] = useState(null);
  const [ethBalance, setEthBalance] = useState(null);
  const [tokenBalance, setTokenBalance] = useState(null);
  const [readChain, setReadChain] = useState(DEFAULT_CHAIN_ID);
  const [error, setError] = useState("");
  const [hasMetaMask, setHasMetaMask] = useState(true);

  const refreshBalances = useCallback(async (acc, chainId) => {
    try {
      if (!acc || !window.ethereum) return;
      const p = new BrowserProvider(window.ethereum);
      setEthBalance(formatEther(await p.getBalance(acc)));
      if (deploymentOf(chainId)) setTokenBalance(await tokenContract(chainId, p).balanceOf(acc));
      else setTokenBalance(null);
    } catch (e) { setError(e.shortMessage || e.message); }
  }, []);

  const sync = useCallback(async () => {
    if (!window.ethereum) return;
    const accs = await window.ethereum.request({ method: "eth_accounts" });
    const cid = Number(await window.ethereum.request({ method: "eth_chainId" }));
    setWalletChain(cid);
    setAccount(accs[0] || null);
    if (accs[0]) refreshBalances(accs[0], cid); else { setEthBalance(null); setTokenBalance(null); }
  }, [refreshBalances]);

  useEffect(() => {
    if (!window.ethereum) { setHasMetaMask(false); return; }
    sync();
    const onAcc = () => sync();
    const onChain = () => sync();
    window.ethereum.on?.("accountsChanged", onAcc);
    window.ethereum.on?.("chainChanged", onChain);
    return () => { window.ethereum.removeListener?.("accountsChanged", onAcc); window.ethereum.removeListener?.("chainChanged", onChain); };
  }, [sync]);

  // làm mới số dư mỗi 8s
  useEffect(() => {
    if (!account || !walletChain) return;
    const t = setInterval(() => refreshBalances(account, walletChain), 8000);
    return () => clearInterval(t);
  }, [account, walletChain, refreshBalances]);

  const connect = useCallback(async () => {
    setError("");
    if (!window.ethereum) { setHasMetaMask(false); setError("Chưa cài MetaMask. Cài tại https://metamask.io"); return; }
    try { await window.ethereum.request({ method: "eth_requestAccounts" }); await sync(); }
    catch (e) { setError(e.code === 4001 ? "Bạn đã từ chối kết nối ví." : e.message); }
  }, [sync]);

  const disconnect = useCallback(() => { setAccount(null); setEthBalance(null); setTokenBalance(null); }, []);

  const switchChain = useCallback(async (chainId) => {
    const c = CHAINS[chainId];
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: c.hex }] });
    } catch (e) {
      if (e.code === 4902 || e?.data?.originalError?.code === 4902) {
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: c.hex, chainName: c.name, rpcUrls: [c.rpc], nativeCurrency: c.currency, blockExplorerUrls: c.explorer ? [c.explorer] : [] }] });
      } else setError(e.message);
    }
  }, []);

  const getSigner = useCallback(async () => new BrowserProvider(window.ethereum).getSigner(), []);

  const value = useMemo(() => ({
    account, walletChain, ethBalance, tokenBalance, readChain, setReadChain, error, setError, hasMetaMask,
    connect, disconnect, switchChain, getSigner, refreshBalances: () => refreshBalances(account, walletChain),
    wrongNetwork: !!account && walletChain !== readChain,
  }), [account, walletChain, ethBalance, tokenBalance, readChain, error, hasMetaMask, connect, disconnect, switchChain, getSigner, refreshBalances]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
