import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

const RANGES = {
  "1h": { label: "1 Hour", days: 1 },
  "24h": { label: "24 Hours", days: 1 },
  "7d": { label: "7 Days", days: 7 },
  "30d": { label: "30 Days", days: 30 },
};

export function useAnalyticsData(bucket, range, currentBuckets) {
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [allStats, setAllStats] = useState([]);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const bucketsRef = useRef(currentBuckets);
  bucketsRef.current = currentBuckets;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const days = RANGES[range]?.days ?? 1;
      const buckets = bucketsRef.current;

      const [historyData, countData] = await Promise.all([
        invoke("get_usage_history", { bucket, range }),
        invoke("get_snapshot_count"),
      ]);

      setHistory(historyData);
      setSnapshotCount(countData);

      if (buckets && buckets.length > 0) {
        const bucketsJson = JSON.stringify(
          buckets.map((b) => ({
            label: b.label,
            utilization: b.utilization,
            resets_at: b.resets_at ?? null,
          }))
        );

        const [statsData, allStatsData] = await Promise.all([
          invoke("get_usage_stats", { bucket, days }),
          invoke("get_all_bucket_stats", { bucketsJson, days }),
        ]);

        const currentBucket = buckets.find((b) => b.label === bucket);
        if (currentBucket && statsData) {
          setStats({ ...statsData, current: currentBucket.utilization });
        } else {
          setStats(statsData);
        }
        setAllStats(allStatsData);
      }
    } catch (e) {
      console.error("Analytics fetch error:", e);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [bucket, range]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { history, stats, allStats, snapshotCount, loading, error, refresh: fetchData };
}
