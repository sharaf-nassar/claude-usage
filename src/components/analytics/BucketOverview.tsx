import { LineChart, Line, YAxis, ResponsiveContainer } from "recharts";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getColor, TrendArrow } from "./shared";
import type { BucketStats, DataPoint } from "../../types";

interface SparklineRowProps {
  stat: BucketStats;
  onClick: (label: string) => void;
  isActive: boolean;
}

function SparklineRow({ stat, onClick, isActive }: SparklineRowProps) {
  const [sparkData, setSparkData] = useState<DataPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    invoke<DataPoint[]>("get_usage_history", {
      bucket: stat.label,
      range: "24h",
    })
      .then((data) => {
        if (!cancelled) {
          const sampled =
            data.length > 30
              ? data.filter((_, i) => i % Math.ceil(data.length / 30) === 0)
              : data;
          setSparkData(sampled);
        }
      })
      .catch((e) => {
        console.error("Sparkline fetch error:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [stat.label, stat.sample_count]);

  const color = getColor(stat.current);

  return (
    <button
      className={`bucket-row${isActive ? " active" : ""}`}
      onClick={() => onClick(stat.label)}
    >
      <span className="bucket-label">{stat.label}</span>
      <span className="bucket-current" style={{ color }}>
        {stat.current.toFixed(0)}%
      </span>
      <span className="bucket-sparkline">
        {sparkData.length > 1 ? (
          <ResponsiveContainer width="100%" height={24}>
            <LineChart
              data={sparkData}
              margin={{ top: 4, right: 2, bottom: 4, left: 2 }}
            >
              <YAxis domain={[0, 100]} hide />
              <Line
                type="monotone"
                dataKey="utilization"
                stroke={color}
                strokeWidth={1.5}
                dot={false}
                animationDuration={200}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="sparkline-placeholder" />
        )}
      </span>
      <span className="bucket-trend">
        <TrendArrow trend={stat.trend} />
      </span>
    </button>
  );
}

interface BucketOverviewProps {
  allStats: BucketStats[];
  activeBucket: string;
  onBucketSelect: (label: string) => void;
}

function BucketOverview({
  allStats,
  activeBucket,
  onBucketSelect,
}: BucketOverviewProps) {
  if (!allStats || allStats.length === 0) {
    return <div className="bucket-overview-empty">No bucket data</div>;
  }

  return (
    <div className="bucket-overview">
      <div className="bucket-overview-header">All Buckets (24h)</div>
      {allStats.map((stat) => (
        <SparklineRow
          key={stat.label}
          stat={stat}
          onClick={onBucketSelect}
          isActive={stat.label === activeBucket}
        />
      ))}
    </div>
  );
}

export default BucketOverview;
