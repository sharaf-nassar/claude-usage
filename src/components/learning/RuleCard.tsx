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
  const color = confidenceColor(rule.confidence);
  const pct = Math.round(rule.confidence * 100);

  return (
    <div className="learning-rule-card">
      <div className="learning-rule-header">
        <span className="learning-rule-name">{rule.name}</span>
        <span className="learning-rule-confidence" style={{ color }}>
          {rule.confidence.toFixed(2)}
        </span>
        <button
          className="learning-rule-delete"
          onClick={() => onDelete(rule.name)}
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
    </div>
  );
}

export default RuleCard;
