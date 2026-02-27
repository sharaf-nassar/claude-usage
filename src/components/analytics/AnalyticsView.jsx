import { useState, useRef, useEffect, useMemo } from "react";
import { useAnalyticsData } from "../../hooks/useAnalyticsData";
import { useTokenData } from "../../hooks/useTokenData";
import UsageChart from "./UsageChart";
import BreakdownPanel from "./BreakdownPanel";
import { getColor, TrendArrow } from "./shared";

function BucketDropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const ref = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open && focusIdx >= 0 && itemRefs.current[focusIdx]) {
      itemRefs.current[focusIdx].focus();
    }
  }, [open, focusIdx]);

  const handleTriggerKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
      setFocusIdx(Math.max(0, options.indexOf(value)));
    }
  };

  const handleMenuKeyDown = (e) => {
    if (e.key === "Escape") {
      setOpen(false);
      setFocusIdx(-1);
      e.stopPropagation();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (focusIdx >= 0 && focusIdx < options.length) {
        onChange(options[focusIdx]);
        setOpen(false);
        setFocusIdx(-1);
      }
    }
  };

  return (
    <div className="bucket-dropdown-wrap" ref={ref}>
      <button
        className="bucket-dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Select bucket: ${value}`}
      >
        {value}
        <span className="bucket-dropdown-arrow">&#9662;</span>
      </button>
      {open && (
        <div
          className="bucket-dropdown-menu"
          role="listbox"
          aria-label="Usage buckets"
          onKeyDown={handleMenuKeyDown}
        >
          {options.map((opt, i) => (
            <button
              key={opt}
              ref={(el) => (itemRefs.current[i] = el)}
              className={`bucket-dropdown-item${opt === value ? " active" : ""}`}
              role="option"
              aria-selected={opt === value}
              tabIndex={focusIdx === i ? 0 : -1}
              onClick={() => {
                onChange(opt);
                setOpen(false);
                setFocusIdx(-1);
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
const RANGE_DAYS = { "1h": 1, "24h": 1, "7d": 7, "30d": 30 };
const DAYS_TO_RANGE = { 1: "24h", 7: "7d", 30: "30d" };

function AnalyticsView({ currentBuckets }) {
  const [range, setRange] = useState("24h");
  const [selectedBucket, setSelectedBucket] = useState(
    () => currentBuckets?.[0]?.label ?? "7 days",
  );
  const [breakdownSelection, setBreakdownSelection] = useState(null);

  const breakdownDays = RANGE_DAYS[range] ?? 1;
  const hasSelection = breakdownSelection !== null;
  // When a breakdown entry is selected, use the breakdown's full time scope
  // so older entries always have visible data in the chart
  const tokenRange = hasSelection
    ? (DAYS_TO_RANGE[breakdownDays] ?? "24h")
    : range;

  const bucketsKey = (currentBuckets ?? [])
    .map((b) => `${b.label}:${b.utilization}`)
    .join(",");

  // eslint-disable-next-line react-hooks/exhaustive-deps -- bucketsKey is an intentional stabilizer for currentBuckets
  const stableBuckets = useMemo(() => currentBuckets, [bucketsKey]);

  const { history, stats, snapshotCount, loading, error } = useAnalyticsData(
    selectedBucket,
    range,
    stableBuckets,
  );

  const tokenHostname =
    breakdownSelection?.type === "host" ? breakdownSelection.key : null;
  const tokenSessionId =
    breakdownSelection?.type === "session" ? breakdownSelection.key : null;
  const tokenCwd =
    breakdownSelection?.type === "project" ? breakdownSelection.key : null;
  const { history: tokenHistory } = useTokenData(
    tokenRange,
    tokenHostname,
    tokenSessionId,
    tokenCwd,
  );

  if (snapshotCount === 0 && !loading) {
    return (
      <div className="analytics-view">
        <div className="analytics-empty-state">
          <svg
            className="analytics-empty-icon"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
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
        <div className={`range-tabs${hasSelection ? " dimmed" : ""}`}>
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
        {stats && (
          <div className="inline-stats">
            <span className="inline-stat">
              <span className="inline-stat-label">Avg</span>
              <span
                className="inline-stat-value"
                style={{ color: getColor(stats.avg) }}
              >
                {stats.avg.toFixed(1)}%
              </span>
            </span>
            <span className="inline-stat">
              <span className="inline-stat-label">Peak</span>
              <span
                className="inline-stat-value"
                style={{ color: getColor(stats.max) }}
              >
                {stats.max.toFixed(1)}%
              </span>
            </span>
            <span className="inline-stat">
              <TrendArrow trend={stats.trend} />
            </span>
          </div>
        )}
        <BucketDropdown
          value={selectedBucket}
          options={(currentBuckets ?? []).map((b) => b.label)}
          onChange={setSelectedBucket}
        />
      </div>

      {error && (
        <div className="analytics-error" role="alert">
          {console.error("Analytics error:", error) ||
            "Failed to load analytics"}
        </div>
      )}

      {loading ? (
        <>
          <div className="chart-skeleton" />
          <div className="breakdown-skeleton">
            <div className="breakdown-skeleton-row" />
            <div className="breakdown-skeleton-row" />
            <div className="breakdown-skeleton-row" />
          </div>
        </>
      ) : (
        <>
          <div className="chart-section">
            <div className="section-title">
              {selectedBucket} Usage
              {hasSelection && (
                <span className="filter-badge">
                  {breakdownSelection.type === "host"
                    ? breakdownSelection.key
                    : breakdownSelection.type === "project"
                      ? breakdownSelection.key.split("/").filter(Boolean).pop()
                      : breakdownSelection.key.slice(0, 8)}
                  <button
                    className="filter-badge-clear"
                    onClick={() => setBreakdownSelection(null)}
                    aria-label="Clear filter"
                  >
                    &#10005;
                  </button>
                </span>
              )}
            </div>
            <UsageChart
              data={history}
              range={range}
              bucket={selectedBucket}
              tokenData={tokenHistory}
            />
          </div>
          <BreakdownPanel
            days={RANGE_DAYS[range] ?? 1}
            selection={breakdownSelection}
            onSelect={setBreakdownSelection}
          />
        </>
      )}
    </div>
  );
}

export default AnalyticsView;
