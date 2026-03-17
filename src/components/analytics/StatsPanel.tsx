import { getColor, TrendArrow } from "./shared";
import { formatTokenCount } from "../../utils/tokens";
import type { BucketStats, TokenStats, CodeStats } from "../../types";

interface StatsPanelProps {
	bucketStats: BucketStats | null;
	tokenStats: TokenStats | null;
	codeStats: CodeStats | null;
}

const LANG_COLORS: Record<string, string> = {
	TypeScript: "#3178c6",
	JavaScript: "#f7df1e",
	Rust: "#dea584",
	Python: "#3776ab",
	CSS: "#563d7c",
	HTML: "#e34c26",
	Go: "#00add8",
	JSON: "#8b8b8b",
	Shell: "#89e051",
	Markdown: "#083fa1",
	SQL: "#e38c00",
	TOML: "#9c4221",
	YAML: "#cb171e",
	Other: "#8b949e",
};

function formatNumber(n: number): string {
	if (Math.abs(n) >= 1000) {
		return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
	}
	return String(n);
}

function StatsPanel({ bucketStats, tokenStats, codeStats }: StatsPanelProps) {
	return (
		<div className="stats-panel">
			{/* Rate Limit Card */}
			{bucketStats && (
				<div className="stats-card">
					<div className="stats-card-title">Rate Limit</div>
					<div className="stats-card-grid">
						<div className="stats-card-item">
							<span className="stats-card-label">Avg</span>
							<span
								className="stats-card-value"
								style={{ color: getColor(bucketStats.avg) }}
							>
								{bucketStats.avg.toFixed(1)}%
							</span>
						</div>
						<div className="stats-card-item">
							<span className="stats-card-label">Peak</span>
							<span
								className="stats-card-value"
								style={{ color: getColor(bucketStats.max) }}
							>
								{bucketStats.max.toFixed(1)}%
							</span>
						</div>
					</div>
					<div className="stats-card-trend">
						<TrendArrow trend={bucketStats.trend} />
					</div>
				</div>
			)}

			{/* Tokens Card */}
			{tokenStats && tokenStats.total_tokens > 0 && (
				<div className="stats-card">
					<div className="stats-card-title">Tokens</div>
					<div className="stats-card-grid">
						<div className="stats-card-item">
							<span className="stats-card-label">In</span>
							<span className="stats-card-value">
								{formatTokenCount(tokenStats.total_input)}
							</span>
						</div>
						<div className="stats-card-item">
							<span className="stats-card-label">Out</span>
							<span className="stats-card-value">
								{formatTokenCount(tokenStats.total_output)}
							</span>
						</div>
						{tokenStats.total_input + tokenStats.total_cache_read > 0 && (
							<div className="stats-card-item" style={{ gridColumn: "span 2" }}>
								<span className="stats-card-label">Cache</span>
								<span
									className="stats-card-value"
									style={{
										color:
											tokenStats.total_cache_read /
												(tokenStats.total_input + tokenStats.total_cache_read) >=
											0.6
												? "#22C55E"
												: tokenStats.total_cache_read /
														(tokenStats.total_input + tokenStats.total_cache_read) >=
													0.3
													? "#EAB308"
													: "#EF4444",
									}}
								>
									{Math.round(
										(tokenStats.total_cache_read /
											(tokenStats.total_input + tokenStats.total_cache_read)) *
											100,
									)}
									%
								</span>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Code Changes Card */}
			{codeStats && (
				<div className="stats-card stats-card--code">
					<div className="stats-card-title stats-card-title--code">
						Code Changes
					</div>
					<div className="stats-card-grid">
						<div className="stats-card-item">
							<span className="stats-card-label">Added</span>
							<span className="stats-card-value" style={{ color: "#22c55e" }}>
								+{formatNumber(codeStats.lines_added)}
							</span>
						</div>
						<div className="stats-card-item">
							<span className="stats-card-label">Removed</span>
							<span className="stats-card-value" style={{ color: "#f87171" }}>
								-{formatNumber(codeStats.lines_removed)}
							</span>
						</div>
						<div className="stats-card-item">
							<span className="stats-card-label">Net</span>
							<span
								className="stats-card-value"
								style={{
									color: codeStats.net_change >= 0 ? "#22c55e" : "#f87171",
								}}
							>
								{codeStats.net_change >= 0 ? "+" : ""}
								{formatNumber(codeStats.net_change)}
							</span>
						</div>
						<div className="stats-card-item">
							<span className="stats-card-label">Avg/Sess</span>
							<span className="stats-card-value">
								{formatNumber(Math.round(codeStats.avg_per_session))}
							</span>
						</div>
					</div>
					{codeStats.by_language.length > 0 && (
						<div className="stats-card-languages">
							<span className="stats-card-label">By Language</span>
							<div className="stats-card-lang-list">
								{codeStats.by_language.slice(0, 5).map((lang) => (
									<div key={lang.language} className="stats-card-lang-row">
										<span
											className="stats-card-lang-dot"
											style={{
												background: LANG_COLORS[lang.language] ?? LANG_COLORS.Other,
											}}
										/>
										<span className="stats-card-lang-name">{lang.language}</span>
										<span className="stats-card-lang-pct">
											{Math.round(lang.percentage)}%
										</span>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export default StatsPanel;
