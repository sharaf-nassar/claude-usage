export function getColor(value) {
  if (value >= 80) return "#f87171";
  if (value >= 50) return "#fbbf24";
  return "#34d399";
}

export function TrendArrow({ trend }) {
  if (trend === "up") return <span className="trend-up">&#9650;</span>;
  if (trend === "down") return <span className="trend-down">&#9660;</span>;
  if (trend === "flat") return <span className="trend-flat">&#9654;</span>;
  return <span className="trend-unknown">&#8212;</span>;
}
