import { useRef, useCallback } from "react";
import { useCrosshair, useCrosshairLine } from "./ChartCrosshairContext";

interface MiniChartProps {
	label: string;
	currentValue: string;
	color: string;
	height?: number;
	emptyText?: string;
	isEmpty?: boolean;
	error?: string | null;
	children: React.ReactNode;
}

function MiniChart({
	label,
	currentValue,
	color,
	height = 80,
	emptyText = "No data",
	isEmpty = false,
	error = null,
	children,
}: MiniChartProps) {
	const crosshairLineRef = useRef<HTMLDivElement>(null);
	const { setHover } = useCrosshair();
	useCrosshairLine(crosshairLineRef);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			const rect = e.currentTarget.getBoundingClientRect();
			const pct = (e.clientX - rect.left) / rect.width;
			setHover(Math.max(0, Math.min(1, pct)));
		},
		[setHover],
	);

	const handleMouseLeave = useCallback(() => {
		setHover(null);
	}, [setHover]);

	if (error) {
		return (
			<div className="mini-chart mini-chart--empty" style={{ height }}>
				<span className="mini-chart-label" style={{ color: `${color}b3` }}>
					{label}
				</span>
				<span className="analytics-error" role="alert" style={{ fontSize: 10, padding: "4px 8px" }}>
					Failed to load {label.toLowerCase()}
				</span>
			</div>
		);
	}

	if (isEmpty) {
		return (
			<div
				className="mini-chart mini-chart--empty"
				style={{ height }}
				role="img"
				aria-label={`${label} chart: ${emptyText}`}
			>
				<span className="mini-chart-label" style={{ color: `${color}b3` }}>
					{label}
				</span>
				<span className="mini-chart-empty-text">{emptyText}</span>
			</div>
		);
	}

	return (
		<div
			className="mini-chart"
			style={{ height }}
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
			role="img"
			aria-label={`${label} chart: current value ${currentValue}`}
		>
			<span className="mini-chart-label" style={{ color: `${color}b3` }}>
				{label}
			</span>
			<span className="mini-chart-value" style={{ color }}>
				{currentValue}
			</span>
			{/* Crosshair line — positioned via ref, no re-renders */}
			<div
				ref={crosshairLineRef}
				className="mini-chart-crosshair"
				style={{ display: "none" }}
			/>
			<div className="mini-chart-body">{children}</div>
		</div>
	);
}

export default MiniChart;
