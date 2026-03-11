import { useState, useRef, useEffect } from "react";
import type { LearningRun } from "../../types";
import { timeAgo } from "../../utils/time";

interface RunHistoryProps {
  runs: LearningRun[];
  analyzing: boolean;
  analyzingInsights?: boolean;
  liveLogs: string[];
}

const LIVE_RUN_ID = -1;

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function RunHistory({ runs, analyzing, analyzingInsights, liveLogs }: RunHistoryProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const isRunning = analyzing || !!analyzingInsights;

  // Auto-select the live run when any analysis starts
  useEffect(() => {
    if (isRunning) {
      setSelectedId(LIVE_RUN_ID);
    }
  }, [isRunning]);

  // Auto-scroll logs to bottom when new entries arrive
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [liveLogs, selectedId]);

  const selected = selectedId === LIVE_RUN_ID
    ? null
    : runs.find((r) => r.id === selectedId) ?? null;
  const showLive = selectedId === LIVE_RUN_ID;

  return (
    <div className="learning-section">
      <div className="learning-section-header">RECENT RUNS</div>

      {!isRunning && runs.length === 0 ? (
        <div className="learning-empty">No analysis runs yet</div>
      ) : (
        <div className="learning-runs-list">
          {isRunning && (
            <div
              className={`learning-run-row${showLive ? " learning-run-row--selected" : ""}`}
              onClick={() =>
                setSelectedId(showLive ? null : LIVE_RUN_ID)
              }
            >
              <span className="learning-run-icon learning-run-icon--live">
                <span className="learning-run-live-dot" />
              </span>
              <span className="learning-run-trigger">{analyzingInsights ? "insights" : "on-demand"}</span>
              <span className="learning-run-result">running…</span>
              <span className="learning-run-time">now</span>
            </div>
          )}
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

      {showLive && (
        <div className="learning-run-detail">
          <div className="learning-run-detail-row">
            <span className="learning-run-detail-label">Status</span>
            <span className="learning-run-icon--live-text">running</span>
          </div>
          <div className="learning-run-detail-row">
            <span className="learning-run-detail-label">Trigger</span>
            <span>on-demand</span>
          </div>
          {liveLogs.length > 0 && (
            <pre className="learning-run-detail-logs" ref={logRef}>
              {liveLogs.join("\n")}
            </pre>
          )}
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
