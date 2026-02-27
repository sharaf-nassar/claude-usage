import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RangeType, TokenDataPoint, TokenStats } from "../types";

const RANGE_DAYS: Record<RangeType, number> = {
  "1h": 1,
  "24h": 1,
  "7d": 7,
  "30d": 30,
};

const REFRESH_DEBOUNCE_MS = 1000;

export function useTokenData(
  range: RangeType,
  hostname: string | null,
  sessionId: string | null,
  cwd: string | null,
) {
  const [history, setHistory] = useState<TokenDataPoint[]>([]);
  const [stats, setStats] = useState<TokenStats | null>(null);
  const [hostnames, setHostnames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const days = RANGE_DAYS[range] ?? 1;
      const hostnameArg = hostname || null;
      const sessionIdArg = sessionId || null;
      const cwdArg = cwd || null;

      const [historyData, statsData, hostnameData] = await Promise.all([
        invoke<TokenDataPoint[]>("get_token_history", {
          range,
          hostname: hostnameArg,
          sessionId: sessionIdArg,
          cwd: cwdArg,
        }),
        invoke<TokenStats>("get_token_stats", {
          days,
          hostname: hostnameArg,
          cwd: cwdArg,
        }),
        invoke<string[]>("get_token_hostnames"),
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
  }, [range, hostname, sessionId, cwd]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh when new token data arrives via Tauri event
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unlistenPromise = listen("tokens-updated", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fetchData, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unlistenPromise.then((fn) => fn());
    };
  }, [fetchData]);

  return { history, stats, hostnames, loading, error, refresh: fetchData };
}
