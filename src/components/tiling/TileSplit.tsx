import { type ReactNode } from "react";
import TileDivider from "./TileDivider";

interface TileSplitProps {
	direction: "horizontal" | "vertical";
	ratio: number;
	firstChild: ReactNode;
	secondChild: ReactNode;
	onRatioChange: (newRatio: number) => void;
	onShiftDrag?: (delta: number) => void;
	shiftHighlight?: boolean;
}

export default function TileSplit({
	direction,
	ratio,
	firstChild,
	secondChild,
	onRatioChange,
	onShiftDrag,
	shiftHighlight = false,
}: TileSplitProps) {
	const isHorizontal = direction === "horizontal";

	const firstStyle = {
		flexBasis: `${ratio * 100}%`,
		flexGrow: 0,
		flexShrink: 1,
		minWidth: isHorizontal ? 80 : undefined,
		minHeight: isHorizontal ? undefined : 80,
		overflow: "hidden" as const,
	};

	const secondStyle = {
		flexBasis: `${(1 - ratio) * 100}%`,
		flexGrow: 0,
		flexShrink: 1,
		minWidth: isHorizontal ? 80 : undefined,
		minHeight: isHorizontal ? undefined : 80,
		overflow: "hidden" as const,
	};

	return (
		<div className={`tile-split tile-split--${isHorizontal ? "row" : "column"}`}>
			<div className="tile-split-child" style={firstStyle}>
				{firstChild}
			</div>
			<TileDivider
				direction={direction}
				currentRatio={ratio}
				onRatioChange={onRatioChange}
				onShiftDrag={onShiftDrag}
				shiftHighlight={shiftHighlight}
			/>
			<div className="tile-split-child" style={secondStyle}>
				{secondChild}
			</div>
		</div>
	);
}
