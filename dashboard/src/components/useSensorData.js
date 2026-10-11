"use client";
import { useEffect, useState } from "react";
import { loadSensorData } from "@/lib/firebase";

/** Poll Firebase mỗi 10s */
export default function useSensorData(intervalMs = 10000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const d = await loadSensorData(); if (alive) { setData(d); setError(""); } }
      catch (e) { if (alive) setError(e.message); }
    };
    load();
    const t = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [intervalMs]);
  return { data, error };
}
