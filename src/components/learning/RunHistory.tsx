import type { LearningRun } from "../../types";
import { timeAgo } from "../../utils/time";

interface RunHistoryProps {
  runs: LearningRun[];
}

function RunHistory({ runs }: RunHistoryProps) {
  if (runs.length === 0) {
    return (
      <div className="learning-section">
        <div className="learning-section-header">RECENT RUNS</div>
        <div className="learning-empty">No analysis runs yet</div>
      </div>
    );
  }

  return (
    <div className="learning-section">
      <div className="learning-section-header">RECENT RUNS</div>
      <div className="learning-runs-list">
        {runs.map((run) => (
          <div key={run.id} className="learning-run-row">
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
    </div>
  );
}

export default RunHistory;
