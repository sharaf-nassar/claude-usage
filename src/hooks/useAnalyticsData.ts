import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RangeType, DataPoint, BucketStats, UsageBucket } from "../types";

const REFRESH_INTERVAL_MS = 60_000; // Re-fetch every 60s to keep chart current

const RANGES: Record<RangeType, { label: string; days: number }> = {
  "1h": { label: "1 Hour", days: 1 },
  "24h": { label: "24 Hours", days: 1 },
  "7d": { label: "7 Days", days: 7 },
  "30d": { label: "30 Days", days: 30 },
};

export function useAnalyticsData(
  bucket: string,
  range: RangeType,
  currentBuckets: UsageBucket[] | undefined,
) {
  const [history, setHistory] = useState<DataPoint[]>([]);
  const [stats, setStats] = useState<BucketStats | null>(null);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bucketsRef = useRef(currentBuckets);
  bucketsRef.current = currentBuckets;
  const hasBuckets = !!(currentBuckets && currentBuckets.length > 0);

  const initialLoadDone = useRef(false);

  const fetchData = useCallback(async () => {
    // Only show loading skeleton on initial fetch, not periodic refreshes
    if (!initialLoadDone.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const days = RANGES[range]?.days ?? 1;
      const buckets = bucketsRef.current;

      const hasBucketsNow = buckets && buckets.length > 0;

      const [historyData, countData, statsData] = await Promise.all([
        invoke<DataPoint[]>("get_usage_history", { bucket, range }),
        invoke<number>("get_snapshot_count"),
        hasBucketsNow
          ? invoke<BucketStats>("get_usage_stats", { bucket, days })
          : Promise.resolve(null),
      ]);

      setHistory(historyData);
      setSnapshotCount(countData);

      if (hasBucketsNow && statsData) {
        const currentBucket = buckets.find((b) => b.label === bucket);
        if (currentBucket) {
          setStats({ ...statsData, current: currentBucket.utilization });
        } else {
          setStats(statsData);
        }
      }
    } catch (e) {
      console.error("Analytics fetch error:", e);
      setError(String(e));
    } finally {
      setLoading(false);
      initialLoadDone.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hasBuckets triggers re-fetch when buckets arrive (data read from ref)
  }, [bucket, range, hasBuckets]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Periodic refresh so the chart stays current even during idle periods
  useEffect(() => {
    const interval = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  return {
    history,
    stats,
    snapshotCount,
    loading,
    error,
    refresh: fetchData,
  };
}
