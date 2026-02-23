import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const RANGE_DAYS = {
  "1h": 1,
  "24h": 1,
  "7d": 7,
  "30d": 30,
};

export function useTokenData(range, hostname) {
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [hostnames, setHostnames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const days = RANGE_DAYS[range] ?? 1;
      const hostnameArg = hostname || null;

      const [historyData, statsData, hostnameData] = await Promise.all([
        invoke("get_token_history", { range, hostname: hostnameArg }),
        invoke("get_token_stats", { days, hostname: hostnameArg }),
        invoke("get_token_hostnames"),
      ]);

      setHistory(historyData);
      setStats(statsData);
      setHostnames(hostnameData);
    } catch (e) {
      console.error("Token data fetch error:", e);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [range, hostname]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { history, stats, hostnames, loading, error, refresh: fetchData };
}
