import { useState, useCallback, useRef, useEffect } from "react";
import type { DropZone } from "./types";

interface DragOverlayProps {
	active: boolean;
	onDrop: (zone: DropZone) => void;
}

function getZoneFromPosition(
	x: number,
	y: number,
	rect: DOMRect,
): DropZone {
	const relX = (x - rect.left) / rect.width;
	const relY = (y - rect.top) / rect.height;

	if (relY < 0.25) return "top";
	if (relY > 0.75) return "bottom";
	if (relX < 0.25) return "left";
	if (relX > 0.75) return "right";
	return "center";
}

export default function DragOverlay({
	active,
	onDrop,
}: DragOverlayProps) {
	const [hoveredZone, setHoveredZone] = useState<DropZone | null>(null);
	const overlayRef = useRef<HTMLDivElement>(null);

	const handleMouseMove = useCallback((e: React.MouseEvent) => {
		const el = overlayRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const zone = getZoneFromPosition(e.clientX, e.clientY, rect);
		setHoveredZone(zone);
	}, []);

	const handleMouseUp = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			e.nativeEvent.stopImmediatePropagation();
			const el = overlayRef.current;
			if (!el) return;
			const rect = el.getBoundingClientRect();
			const zone = getZoneFromPosition(e.clientX, e.clientY, rect);
			onDrop(zone);
		},
		[onDrop],
	);

	const handleMouseLeave = useCallback(() => {
		setHoveredZone(null);
	}, []);

	useEffect(() => {
		if (!active) setHoveredZone(null);
	}, [active]);

	if (!active) return null;

	return (
		<div
			ref={overlayRef}
			className="drag-overlay"
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
			onMouseLeave={handleMouseLeave}
		>
			<div className={`drag-zone drag-zone--top${hoveredZone === "top" ? " active" : ""}`} />
			<div className={`drag-zone drag-zone--bottom${hoveredZone === "bottom" ? " active" : ""}`} />
			<div className={`drag-zone drag-zone--left${hoveredZone === "left" ? " active" : ""}`} />
			<div className={`drag-zone drag-zone--right${hoveredZone === "right" ? " active" : ""}`} />
			<div className={`drag-zone drag-zone--center${hoveredZone === "center" ? " active" : ""}`} />
		</div>
	);
}
