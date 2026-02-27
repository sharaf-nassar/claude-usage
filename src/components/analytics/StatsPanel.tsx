import type { ReactNode } from "react";
import type { BucketStats } from "../../types";
import { getColor, TrendArrow } from "./shared";

interface StatCardProps {
  label: string;
  value: ReactNode;
  suffix?: string;
  color?: string;
  subtext?: string;
}

function StatCard({ label, value, suffix, color, subtext }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : undefined}>
        {value}
        {suffix && <span className="stat-suffix">{suffix}</span>}
      </div>
      {subtext && <div className="stat-subtext">{subtext}</div>}
    </div>
  );
}

interface StatsPanelProps {
  stats: BucketStats | null;
}

function StatsPanel({ stats }: StatsPanelProps) {
  if (!stats) {
    return <div className="stats-panel stats-empty">No statistics available</div>;
  }

  return (
    <div className="stats-panel">
      <StatCard
        label="Average"
        value={stats.avg.toFixed(1)}
        suffix="%"
        color={getColor(stats.avg)}
      />
      <StatCard
        label="Peak"
        value={stats.max.toFixed(1)}
        suffix="%"
        color={getColor(stats.max)}
      />
      <StatCard
        label="Trend"
        value={<TrendArrow trend={stats.trend} />}
        subtext={`${stats.sample_count} samples`}
      />
    </div>
  );
}

export default StatsPanel;
