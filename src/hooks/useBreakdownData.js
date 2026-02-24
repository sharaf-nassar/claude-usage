import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const REFRESH_DEBOUNCE_MS = 1000;

export function useBreakdownData(mode, days) {
  const [data, setData] = useState([]);
  const [dataMode, setDataMode] = useState(mode);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const currentMode = useRef(mode);

  useEffect(() => {
    currentMode.current = mode;
  }, [mode]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let result;
      if (mode === "hosts") {
        result = await invoke("get_host_breakdown", { days });
      } else {
        result = await invoke("get_session_breakdown", {
          days,
          hostname: null,
        });
      }
      // Only apply if mode hasn't changed during the fetch
      if (currentMode.current === mode) {
        setData(result);
        setDataMode(mode);
      }
    } catch (e) {
      console.error("Breakdown data fetch error:", e);
      if (currentMode.current === mode) {
        setError(String(e));
      }
    } finally {
      if (currentMode.current === mode) {
        setLoading(false);
      }
    }
  }, [mode, days]);

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

  // Return loading when mode and dataMode are out of sync
  const stale = mode !== dataMode;

  return {
    data: stale ? [] : data,
    loading: loading || stale,
    error,
    refresh: fetchData,
  };
}
