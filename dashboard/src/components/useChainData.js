"use client";
import { useCallback, useEffect, useState } from "react";
import { loadChainData } from "@/lib/fl";
import { useWallet } from "./WalletProvider";

/** Poll dữ liệu on-chain mỗi 5s (realtime dashboard) */
export default function useChainData(intervalMs = 5000) {
  const { readChain } = useWallet();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await loadChainData(readChain)); setError(""); }
    catch (e) { setError(e.shortMessage || e.message); }
    finally { setLoading(false); }
  }, [readChain]);

  useEffect(() => {
    setLoading(true); setData(null);
    load();
    const t = setInterval(load, intervalMs);
    return () => clearInterval(t);
  }, [load, intervalMs]);

  return { data, error, loading, reload: load, chainId: readChain };
}
