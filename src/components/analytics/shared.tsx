import type { TrendType } from "../../types";

export function getColor(value: number): string {
  if (value >= 80) return "#f87171";
  if (value >= 50) return "#fbbf24";
  return "#34d399";
}

interface TrendArrowProps {
  trend: TrendType;
}

export function TrendArrow({ trend }: TrendArrowProps) {
  if (trend === "up")
    return (
      <span className="trend-up" aria-hidden="true">
        &#9650;
      </span>
    );
  if (trend === "down")
    return (
      <span className="trend-down" aria-hidden="true">
        &#9660;
      </span>
    );
  if (trend === "flat")
    return (
      <span className="trend-flat" aria-hidden="true">
        &#9654;
      </span>
    );
  return (
    <span className="trend-unknown" aria-hidden="true">
      &#8212;
    </span>
  );
}
