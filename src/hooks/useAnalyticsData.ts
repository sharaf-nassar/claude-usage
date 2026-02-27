import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  RangeType,
  DataPoint,
  BucketStats,
  UsageBucket,
} from "../types";

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
  const [allStats, setAllStats] = useState<BucketStats[]>([]);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bucketsRef = useRef(currentBuckets);
  bucketsRef.current = currentBuckets;
  const hasBuckets = !!(currentBuckets && currentBuckets.length > 0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const days = RANGES[range]?.days ?? 1;
      const buckets = bucketsRef.current;

      const [historyData, countData] = await Promise.all([
        invoke<DataPoint[]>("get_usage_history", { bucket, range }),
        invoke<number>("get_snapshot_count"),
      ]);

      setHistory(historyData);
      setSnapshotCount(countData);

      if (buckets && buckets.length > 0) {
        const bucketsJson = JSON.stringify(
          buckets.map((b) => ({
            label: b.label,
            utilization: b.utilization,
            resets_at: b.resets_at ?? null,
          })),
        );

        const [statsData, allStatsData] = await Promise.all([
          invoke<BucketStats>("get_usage_stats", { bucket, days }),
          invoke<BucketStats[]>("get_all_bucket_stats", { bucketsJson, days }),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hasBuckets triggers re-fetch when buckets arrive (data read from ref)
  }, [bucket, range, hasBuckets]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    history,
    stats,
    allStats,
    snapshotCount,
    loading,
    error,
    refresh: fetchData,
  };
}
