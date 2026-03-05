import { useState, useRef, useEffect } from "react";
import type { LearningRun } from "../../types";
import { timeAgo } from "../../utils/time";

interface RunHistoryProps {
  runs: LearningRun[];
  analyzing: boolean;
  liveLogs: string[];
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function RunHistory({ runs, analyzing, liveLogs }: RunHistoryProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const liveLogRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (liveLogRef.current) {
      liveLogRef.current.scrollTop = liveLogRef.current.scrollHeight;
    }
  }, [liveLogs]);

  const selected = runs.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="learning-section">
      <div className="learning-section-header">RECENT RUNS</div>

      {analyzing && liveLogs.length > 0 && (
        <div className="learning-run-live">
          <div className="learning-run-live-header">
            <span className="learning-run-live-dot" />
            Running analysis…
          </div>
          <pre className="learning-run-detail-logs" ref={liveLogRef}>
            {liveLogs.join("\n")}
          </pre>
        </div>
      )}

      {runs.length === 0 && !analyzing ? (
        <div className="learning-empty">No analysis runs yet</div>
      ) : (
        <div className="learning-runs-list">
          {runs.map((run) => (
            <div
              key={run.id}
              className={`learning-run-row${run.id === selectedId ? " learning-run-row--selected" : ""}`}
              onClick={() =>
                setSelectedId(run.id === selectedId ? null : run.id)
              }
            >
              <span
                className={`learning-run-icon ${run.status === "completed" ? "learning-run-icon--ok" : "learning-run-icon--fail"}`}
              >
                {run.status === "completed" ? "\u2713" : "\u2717"}
              </span>
              <span className="learning-run-trigger">{run.trigger_mode}</span>
              <span className="learning-run-result">
                {run.status === "completed"
                  ? `+${run.rules_created} rule${run.rules_created !== 1 ? "s" : ""}`
                  : "failed"}
              </span>
              <span className="learning-run-time">
                {timeAgo(run.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="learning-run-detail">
          <div className="learning-run-detail-row">
            <span className="learning-run-detail-label">Status</span>
            <span
              className={
                selected.status === "completed"
                  ? "learning-run-icon--ok"
                  : "learning-run-icon--fail"
              }
            >
              {selected.status}
            </span>
          </div>
          <div className="learning-run-detail-row">
            <span className="learning-run-detail-label">Trigger</span>
            <span>{selected.trigger_mode}</span>
          </div>
          <div className="learning-run-detail-row">
            <span className="learning-run-detail-label">Observations</span>
            <span>{selected.observations_analyzed}</span>
          </div>
          <div className="learning-run-detail-row">
            <span className="learning-run-detail-label">Rules created</span>
            <span>{selected.rules_created}</span>
          </div>
          {selected.rules_updated > 0 && (
            <div className="learning-run-detail-row">
              <span className="learning-run-detail-label">Rules updated</span>
              <span>{selected.rules_updated}</span>
            </div>
          )}
          <div className="learning-run-detail-row">
            <span className="learning-run-detail-label">Duration</span>
            <span>{formatDuration(selected.duration_ms)}</span>
          </div>
          <div className="learning-run-detail-row">
            <span className="learning-run-detail-label">Time</span>
            <span>{new Date(selected.created_at).toLocaleString()}</span>
          </div>
          {selected.error && (
            <div className="learning-run-detail-error">{selected.error}</div>
          )}
          {selected.logs && (
            <pre className="learning-run-detail-logs">{selected.logs}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export default RunHistory;
