import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const RANGE_DAYS = {
  "1h": 1,
  "24h": 1,
  "7d": 7,
  "30d": 30,
};

const REFRESH_DEBOUNCE_MS = 1000;

export function useTokenData(range, hostname, sessionId) {
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
      const sessionIdArg = sessionId || null;

      const [historyData, statsData, hostnameData] = await Promise.all([
        invoke("get_token_history", {
          range,
          hostname: hostnameArg,
          sessionId: sessionIdArg,
        }),
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
  }, [range, hostname, sessionId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh when new token data arrives via Tauri event
  useEffect(() => {
    let timer = null;
    const unlistenPromise = listen("tokens-updated", () => {
      clearTimeout(timer);
      timer = setTimeout(fetchData, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(timer);
      unlistenPromise.then((fn) => fn());
    };
  }, [fetchData]);

  return { history, stats, hostnames, loading, error, refresh: fetchData };
}
