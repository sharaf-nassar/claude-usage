import { useCallback, useRef, useState, useEffect } from "react";

interface TileDividerProps {
	direction: "horizontal" | "vertical";
	onRatioChange: (newRatio: number) => void;
	onShiftDrag?: (delta: number) => void;
	currentRatio: number;
	shiftHighlight?: boolean;
}

const KEYBOARD_STEP = 0.05;
const TOOLTIP_DELAY = 500;
const MIN_PX = 80;

export default function TileDivider({
	direction,
	onRatioChange,
	onShiftDrag,
	currentRatio,
	shiftHighlight = false,
}: TileDividerProps) {
	const dividerRef = useRef<HTMLDivElement>(null);
	const [showTooltip, setShowTooltip] = useState(false);
	const tooltipTimer = useRef<ReturnType<typeof setTimeout>>(null);

	useEffect(() => {
		return () => {
			if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
		};
	}, []);

	const handleMouseEnter = useCallback(() => {
		tooltipTimer.current = setTimeout(() => setShowTooltip(true), TOOLTIP_DELAY);
	}, []);

	const handleMouseLeave = useCallback(() => {
		if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
		setShowTooltip(false);
	}, []);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			setShowTooltip(false);
			if (tooltipTimer.current) clearTimeout(tooltipTimer.current);

			const dividerEl = dividerRef.current;
			if (!dividerEl) return;
			const parent = dividerEl.parentElement;
			if (!parent) return;

			document.documentElement.classList.add("tiling-dragging");
			dividerEl.classList.add("active");

			const startRatio = currentRatio;
			const rect = parent.getBoundingClientRect();
			const isHorizontal = direction === "horizontal";
			const totalSize = isHorizontal ? rect.width : rect.height;
			const startOffset = isHorizontal ? rect.left : rect.top;

			const minRatio = Math.max(0.05, MIN_PX / totalSize);
			const maxRatio = Math.min(0.95, 1 - MIN_PX / totalSize);
			let rafId = 0;

			const onMouseMove = (ev: MouseEvent) => {
				cancelAnimationFrame(rafId);
				const clientPos = isHorizontal ? ev.clientX : ev.clientY;
				const shiftHeld = ev.shiftKey;
				rafId = requestAnimationFrame(() => {
					const newRatio = Math.max(
						minRatio,
						Math.min(maxRatio, (clientPos - startOffset) / totalSize),
					);
					onRatioChange(newRatio);

					if (shiftHeld && onShiftDrag) {
						const delta = newRatio - startRatio;
						onShiftDrag(delta);
					}
				});
			};

			const onMouseUp = () => {
				cancelAnimationFrame(rafId);
				document.documentElement.classList.remove("tiling-dragging");
				dividerEl.classList.remove("active");
				document.removeEventListener("mousemove", onMouseMove);
				document.removeEventListener("mouseup", onMouseUp);
			};

			document.addEventListener("mousemove", onMouseMove);
			document.addEventListener("mouseup", onMouseUp);
		},
		[direction, currentRatio, onRatioChange, onShiftDrag],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			const isHorizontal = direction === "horizontal";
			let delta = 0;

			if (isHorizontal) {
				if (e.key === "ArrowLeft") delta = -KEYBOARD_STEP;
				else if (e.key === "ArrowRight") delta = KEYBOARD_STEP;
			} else {
				if (e.key === "ArrowUp") delta = -KEYBOARD_STEP;
				else if (e.key === "ArrowDown") delta = KEYBOARD_STEP;
			}

			if (delta === 0) return;
			e.preventDefault();

			onRatioChange(currentRatio + delta);

			if (e.shiftKey && onShiftDrag) {
				onShiftDrag(delta);
			}
		},
		[direction, currentRatio, onRatioChange, onShiftDrag],
	);

	const isHorizontal = direction === "horizontal";

	return (
		<div
			ref={dividerRef}
			className={`tile-divider tile-divider--${isHorizontal ? "horizontal" : "vertical"}${shiftHighlight ? " tile-divider--shift-highlight" : ""}`}
			role="separator"
			aria-orientation={isHorizontal ? "vertical" : "horizontal"}
			aria-label="Resize panels"
			tabIndex={0}
			onMouseDown={handleMouseDown}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
			onKeyDown={handleKeyDown}
		>
			{showTooltip && (
				<div className={`tile-divider-tooltip tile-divider-tooltip--${isHorizontal ? "horizontal" : "vertical"}`}>
					Drag to resize · Shift+drag to resize all
				</div>
			)}
		</div>
	);
}
