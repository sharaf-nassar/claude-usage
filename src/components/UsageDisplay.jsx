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
  const [focusIdx, setFocusIdx] = useState(-1);
  const menuRef = useRef(null);
  const itemRefs = useRef([]);

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

  useEffect(() => {
    if (open && focusIdx >= 0 && itemRefs.current[focusIdx]) {
      itemRefs.current[focusIdx].focus();
    }
  }, [open, focusIdx]);

  if (!data) {
    return <div className="loading">Loading...</div>;
  }

  if (data.error) {
    console.error("Usage fetch error:", data.error);
    const msg = data.error.includes("Credentials")
      ? data.error
      : "Failed to load usage data";
    return (
      <div className="error-label" role="alert">
        {msg}
      </div>
    );
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
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen(true);
                const activeIdx = TIME_MODES.findIndex(
                  (m) => m.key === timeMode,
                );
                setFocusIdx(activeIdx >= 0 ? activeIdx : 0);
              }
            }}
            aria-label="Display settings"
            aria-haspopup="true"
            aria-expanded={open}
          >
            &#9881;
          </button>
          {open && (
            <div
              className="cog-menu cog-menu-center"
              ref={menuRef}
              role="menu"
              aria-label="Time display mode"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  setFocusIdx(-1);
                  e.stopPropagation();
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setFocusIdx((i) => Math.min(i + 1, TIME_MODES.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setFocusIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (focusIdx >= 0 && focusIdx < TIME_MODES.length) {
                    onTimeModeChange(TIME_MODES[focusIdx].key);
                    setOpen(false);
                    setFocusIdx(-1);
                  }
                }
              }}
            >
              <div className="cog-menu-header">Time Display</div>
              {TIME_MODES.map((m, i) => (
                <button
                  key={m.key}
                  ref={(el) => (itemRefs.current[i] = el)}
                  className={`cog-menu-item${timeMode === m.key ? " active" : ""}`}
                  role="menuitem"
                  tabIndex={focusIdx === i ? 0 : -1}
                  aria-label={m.tip}
                  onClick={() => {
                    onTimeModeChange(m.key);
                    setOpen(false);
                    setFocusIdx(-1);
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
      {data.buckets.map((bucket, i) => (
        <UsageRow
          key={bucket.label}
          label={bucket.label}
          utilization={bucket.utilization}
          resetsAt={bucket.resets_at}
          timeMode={timeMode}
          showTokenSparkline={i === 0}
        />
      ))}
    </div>
  );
}

export default UsageDisplay;
