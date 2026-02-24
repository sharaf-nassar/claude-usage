import { useState, useMemo } from "react";
import { useBreakdownData } from "../../hooks/useBreakdownData";
import { formatTokenCount } from "../../utils/tokens";

function formatRelativeTime(isoString) {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

const MODES = ["hosts", "sessions"];
const MODE_LABELS = { hosts: "Hosts", sessions: "Sessions" };
const PAGE_SIZE = 5;

function BreakdownPanel({ days, selection, onSelect }) {
  const [mode, setMode] = useState("hosts");
  const [page, setPage] = useState(0);
  const { data, loading, error } = useBreakdownData(mode, days);

  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageData = useMemo(
    () => data.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
    [data, currentPage],
  );

  const handleModeChange = (m) => {
    setMode(m);
    setPage(0);
  };

  const handleRowClick = (type, key, row) => {
    if (selection?.type === type && selection?.key === key) {
      onSelect(null);
    } else {
      onSelect({
        type,
        key,
        firstSeen: row.first_seen || row.last_active,
        lastActive: row.last_active,
      });
    }
  };

  const isSelected = (type, key) =>
    selection?.type === type && selection?.key === key;

  return (
    <div className="breakdown-panel">
      <div className="breakdown-header">
        <div className="range-tabs breakdown-toggle">
          {MODES.map((m) => (
            <button
              key={m}
              className={`range-tab${mode === m ? " active" : ""}`}
              onClick={() => handleModeChange(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {selection && (
          <button
            className="breakdown-clear-btn"
            onClick={() => onSelect(null)}
            aria-label="Clear selection"
          >
            &#10005;
          </button>
        )}
        {data.length > PAGE_SIZE && (
          <div className="breakdown-pagination">
            <button
              className="breakdown-page-btn"
              disabled={currentPage === 0}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Previous page"
            >
              &#9664;
            </button>
            <span className="breakdown-page-info">
              {currentPage + 1}/{totalPages}
            </span>
            <button
              className="breakdown-page-btn"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              &#9654;
            </button>
          </div>
        )}
      </div>

      {error && <div className="analytics-error">{error}</div>}

      {loading ? (
        <div className="breakdown-empty">Loading...</div>
      ) : data.length === 0 ? (
        <div className="breakdown-empty">No {mode} data yet</div>
      ) : (
        <div
          className="breakdown-list"
          role="list"
          aria-label={`${MODE_LABELS[mode]} breakdown`}
        >
          {mode === "hosts"
            ? pageData.map((row) => (
                <div
                  key={row.hostname}
                  className={`breakdown-row${isSelected("host", row.hostname) ? " selected" : ""}`}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${row.hostname}: ${formatTokenCount(row.total_tokens)} tokens, ${row.turn_count} turns`}
                  onClick={() => handleRowClick("host", row.hostname, row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleRowClick("host", row.hostname, row);
                    }
                  }}
                >
                  <span className="breakdown-name" title={row.hostname}>
                    {row.hostname}
                  </span>
                  <span className="breakdown-tokens">
                    {formatTokenCount(row.total_tokens)}
                  </span>
                  <span className="breakdown-turns">
                    {row.turn_count} turns
                  </span>
                  <span className="breakdown-time">
                    {formatRelativeTime(row.last_active)}
                  </span>
                </div>
              ))
            : pageData.map((row) => (
                <div
                  key={row.session_id}
                  className={`breakdown-row breakdown-row-session${isSelected("session", row.session_id) ? " selected" : ""}`}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`Session ${row.session_id.slice(0, 8)} on ${row.hostname}: ${formatTokenCount(row.total_tokens)} tokens, ${row.turn_count} turns`}
                  onClick={() => handleRowClick("session", row.session_id, row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleRowClick("session", row.session_id, row);
                    }
                  }}
                >
                  <span className="breakdown-name" title={row.session_id}>
                    {row.session_id.slice(0, 8)}
                    <span className="breakdown-host-tag">{row.hostname}</span>
                  </span>
                  <span className="breakdown-tokens">
                    {formatTokenCount(row.total_tokens)}
                  </span>
                  <span className="breakdown-turns">
                    {row.turn_count} turns
                  </span>
                  <span className="breakdown-time">
                    {formatRelativeTime(row.last_active)}
                  </span>
                </div>
              ))}
        </div>
      )}
    </div>
  );
}

export default BreakdownPanel;
