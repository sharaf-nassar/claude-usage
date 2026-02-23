import { useState, useRef, useEffect } from "react";
import UsageRow from "./UsageRow";

const TIME_MODES = [
  {
    key: "marker",
    label: "Pace marker",
    tip: "Vertical line on the usage bar showing expected pace",
  },
  {
    key: "dual",
    label: "Dual bars",
    tip: "Second bar below usage showing time elapsed in period",
  },
  {
    key: "background",
    label: "Background fill",
    tip: "Row background fills as time passes toward reset",
  },
];

function UsageDisplay({ data, timeMode, onTimeModeChange }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!data) {
    return <div className="loading">Loading...</div>;
  }

  if (data.error) {
    console.error("Usage fetch error:", data.error);
    const msg = data.error.includes("Credentials")
      ? data.error
      : "Failed to load usage data";
    return <div className="error-label">{msg}</div>;
  }

  if (data.buckets.length === 0) {
    return <div className="loading">No usage data</div>;
  }

  return (
    <div className="usage-display">
      <div className="col-header">
        <span className="col-limits">Limits</span>
        <span className="col-center-cog">
          <button
            className="titlebar-cog"
            onClick={() => setOpen((v) => !v)}
            title="Display settings"
          >
            &#9881;
          </button>
          {open && (
            <div className="cog-menu cog-menu-center" ref={menuRef}>
              <div className="cog-menu-header">Time Display</div>
              {TIME_MODES.map((m) => (
                <button
                  key={m.key}
                  className={`cog-menu-item${timeMode === m.key ? " active" : ""}`}
                  title={m.tip}
                  onClick={() => {
                    onTimeModeChange(m.key);
                    setOpen(false);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </span>
        <span className="col-resets">Resets In</span>
      </div>
      {data.buckets.map((bucket) => (
        <UsageRow
          key={bucket.label}
          label={bucket.label}
          utilization={bucket.utilization}
          resetsAt={bucket.resets_at}
          timeMode={timeMode}
        />
      ))}
    </div>
  );
}

export default UsageDisplay;
