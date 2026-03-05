import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LearnedRule } from "../../types";

interface RuleCardProps {
  rule: LearnedRule;
  onDelete: (name: string) => void;
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.7) return "#22C55E";
  if (confidence >= 0.4) return "#EAB308";
  return "#EF4444";
}

function RuleCard({ rule, onDelete }: RuleCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const color = confidenceColor(rule.confidence);
  const pct = Math.round(rule.confidence * 100);

  const toggleExpand = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (content === null) {
      setLoading(true);
      try {
        const text = await invoke<string>("read_rule_content", {
          filePath: rule.file_path,
        });
        setContent(text);
      } catch {
        setContent("(Failed to load rule content)");
      } finally {
        setLoading(false);
      }
    }
    setExpanded(true);
  };

  return (
    <div className="learning-rule-card">
      <div className="learning-rule-header" onClick={toggleExpand}>
        <span className="learning-rule-expand">{expanded ? "▾" : "▸"}</span>
        <span className="learning-rule-name">{rule.name}</span>
        <span className="learning-rule-confidence" style={{ color }}>
          {rule.confidence.toFixed(2)}
        </span>
        <button
          className="learning-rule-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(rule.name);
          }}
          aria-label={`Delete rule ${rule.name}`}
        >
          &times;
        </button>
      </div>
      <div className="learning-rule-bar-track">
        <div
          className="learning-rule-bar-fill"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      {rule.domain && (
        <span className="learning-rule-domain">{rule.domain}</span>
      )}
      {expanded && (
        <pre className="learning-rule-content">
          {loading ? "Loading…" : content}
        </pre>
      )}
    </div>
  );
}

export default RuleCard;
