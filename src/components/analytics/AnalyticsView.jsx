import { useState, useRef, useEffect, useMemo } from "react";
import { useAnalyticsData } from "../../hooks/useAnalyticsData";
import { useTokenData } from "../../hooks/useTokenData";
import UsageChart from "./UsageChart";
import StatsPanel from "./StatsPanel";
import BucketOverview from "./BucketOverview";

function BucketDropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="bucket-dropdown-wrap" ref={ref}>
      <button
        className="bucket-dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        {value}
        <span className="bucket-dropdown-arrow">&#9662;</span>
      </button>
      {open && (
        <div className="bucket-dropdown-menu">
          {options.map((opt) => (
            <button
              key={opt}
              className={`bucket-dropdown-item${opt === value ? " active" : ""}`}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const RANGES = ["1h", "24h", "7d", "30d"];
const RANGE_LABELS = { "1h": "1H", "24h": "24H", "7d": "7D", "30d": "30D" };

function AnalyticsView({ currentBuckets }) {
  const [range, setRange] = useState("24h");
  const [selectedBucket, setSelectedBucket] = useState(
    () => currentBuckets?.[0]?.label ?? "7 days",
  );

  const bucketsKey = (currentBuckets ?? [])
    .map((b) => `${b.label}:${b.utilization}`)
    .join(",");

  const stableBuckets = useMemo(() => currentBuckets, [bucketsKey]);

  const { history, stats, allStats, snapshotCount, loading, error } =
    useAnalyticsData(selectedBucket, range, stableBuckets);

  const { history: tokenHistory } = useTokenData(range, null);

  if (snapshotCount === 0 && !loading) {
    return (
      <div className="analytics-view">
        <div className="analytics-empty-state">
          <div className="analytics-empty-icon">&#9201;</div>
          <div className="analytics-empty-title">Collecting usage data...</div>
          <div className="analytics-empty-desc">
            Analytics will appear here once enough data has been recorded. Data
            is captured every 60 seconds.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="analytics-view">
      <div className="analytics-controls">
        <div className="range-tabs">
          {RANGES.map((r) => (
            <button
              key={r}
              className={`range-tab${range === r ? " active" : ""}`}
              onClick={() => setRange(r)}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
        <BucketDropdown
          value={selectedBucket}
          options={(currentBuckets ?? []).map((b) => b.label)}
          onChange={setSelectedBucket}
        />
      </div>

      {error && (
        <div className="analytics-error">
          {console.error("Analytics error:", error) ||
            "Failed to load analytics"}
        </div>
      )}

      {loading ? (
        <div className="analytics-loading">Loading analytics...</div>
      ) : (
        <>
          <div className="chart-section">
            <div className="section-title">{selectedBucket} Usage</div>
            <UsageChart
              data={history}
              range={range}
              bucket={selectedBucket}
              tokenData={tokenHistory}
            />
          </div>

          <StatsPanel stats={stats} />

          <BucketOverview
            allStats={allStats}
            activeBucket={selectedBucket}
            onBucketSelect={setSelectedBucket}
          />
        </>
      )}
    </div>
  );
}

export default AnalyticsView;
