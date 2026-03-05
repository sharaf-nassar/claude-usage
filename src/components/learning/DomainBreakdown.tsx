import type { LearnedRule } from "../../types";

interface DomainBreakdownProps {
  rules: LearnedRule[];
}

function DomainBreakdown({ rules }: DomainBreakdownProps) {
  const domainCounts = new Map<string, number>();
  for (const rule of rules) {
    const domain = rule.domain ?? "uncategorized";
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }

  const sorted = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(...sorted.map(([, c]) => c), 1);

  if (sorted.length === 0) return null;

  return (
    <div className="learning-domains">
      <span className="learning-domains-label">DOMAINS</span>
      {sorted.map(([domain, count]) => (
        <div key={domain} className="learning-domain-row">
          <span className="learning-domain-name">{domain}</span>
          <div className="learning-domain-bar-track">
            <div
              className="learning-domain-bar-fill"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <span className="learning-domain-count">{count}</span>
        </div>
      ))}
    </div>
  );
}

export default DomainBreakdown;
