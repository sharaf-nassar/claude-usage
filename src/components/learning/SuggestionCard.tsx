import { useState } from "react";
import type { OptimizationSuggestion } from "../../hooks/useMemoryData";

interface SuggestionCardProps {
  suggestion: OptimizationSuggestion;
  onApprove: (id: number) => void;
  onDeny: (id: number) => void;
  onUndeny?: (id: number) => void;
}

const ACTION_COLORS: Record<string, string> = {
  delete: "#EF4444",
  update: "#3B82F6",
  merge: "#8B5CF6",
  create: "#22C55E",
  flag: "#EAB308",
};

export function SuggestionCard({ suggestion, onApprove, onDeny, onUndeny }: SuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const color = ACTION_COLORS[suggestion.action_type] || "#888";
  const isPending = suggestion.status === "pending";
  const isDenied = suggestion.status === "denied";
  const isFlag = suggestion.action_type === "flag";

  return (
    <div
      className="learning-rule-card"
      style={{
        borderColor: isPending ? `${color}40` : "rgba(255,255,255,0.1)",
        opacity: isDenied ? 0.6 : 1,
      }}
    >
      <div
        className="learning-rule-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="learning-rule-expand">{expanded ? "▾" : "▸"}</span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: "1px 5px",
            borderRadius: 3,
            background: `${color}20`,
            color,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {suggestion.action_type}
        </span>
        <span className="learning-rule-name">
          {suggestion.target_file || "(new file)"}
        </span>
        {suggestion.status !== "pending" && (
          <span
            className={`learning-rule-state learning-rule-state--${
              suggestion.status === "approved" ? "confirmed" : "invalidated"
            }`}
          >
            {suggestion.status}
          </span>
        )}
        {isPending && (
          <span style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
            <button
              className="learning-analyze-btn"
              style={{ borderColor: color, color, fontSize: 9, padding: "2px 8px" }}
              onClick={(e) => {
                e.stopPropagation();
                onApprove(suggestion.id);
              }}
            >
              {isFlag ? "Dismiss" : "Approve"}
            </button>
            {!isFlag && (
              <button
                className="learning-rule-delete"
                style={{ fontSize: 11, color: "#EF4444" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeny(suggestion.id);
                }}
              >
                Deny
              </button>
            )}
          </span>
        )}
        {isDenied && onUndeny && (
          <button
            className="learning-rule-delete"
            style={{ fontSize: 10, color: "#888" }}
            onClick={(e) => {
              e.stopPropagation();
              onUndeny(suggestion.id);
            }}
          >
            Undeny
          </button>
        )}
      </div>
      <div className="learning-rule-bar-track">
        <div
          className="learning-rule-bar-fill"
          style={{ width: "100%", background: color }}
        />
      </div>
      <span className="learning-rule-domain">{suggestion.reasoning}</span>
      {suggestion.error && (
        <div className="learning-run-detail-error" style={{ marginTop: 4 }}>
          {suggestion.error}
        </div>
      )}
      {expanded && suggestion.proposed_content && (
        <pre className="learning-rule-content">{suggestion.proposed_content}</pre>
      )}
      {expanded && suggestion.merge_sources && suggestion.merge_sources.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 10, color: "rgba(255,255,255,0.45)" }}>
          Merging: {suggestion.merge_sources.join(", ")}
        </div>
      )}
    </div>
  );
}
