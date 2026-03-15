import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import type { LayoutNode, SectionId, DragState, DropZone } from "./types";
import {
	removePanel,
	insertPanel,
	swapPanels,
	countLeaves,
	collectSplitsAtDepth,
	updateRatioAtPath,
	getRatioAtPath,
} from "./layoutEngine";
import TileSplit from "./TileSplit";
import TileLeaf from "./TileLeaf";
import DragOverlay from "./DragOverlay";

interface TilingContainerProps {
	layout: LayoutNode;
	panels: Record<SectionId, ReactNode>;
	onLayoutChange: (newLayout: LayoutNode) => void;
	timeMode?: string;
}

export default function TilingContainer({
	layout,
	panels,
	onLayoutChange,
	timeMode,
}: TilingContainerProps) {
	const [dragState, setDragState] = useState<DragState>(null);
	const [shiftHeld, setShiftHeld] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const siblingOriginalRatios = useRef<Map<string, number>>(new Map());
	const layoutRef = useRef(layout);
	useEffect(() => {
		layoutRef.current = layout;
	});

	const leafCount = countLeaves(layout);
	const isDraggable = leafCount > 1;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Shift") setShiftHeld(true);
		};
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.key === "Shift") setShiftHeld(false);
		};
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("keyup", onKeyUp);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("keyup", onKeyUp);
		};
	}, []);

	const handleDragStart = useCallback(
		(panelId: SectionId) => {
			setDragState({ draggedPanelId: panelId, sourceTree: layoutRef.current });
			document.documentElement.classList.add("tiling-panel-dragging");
		},
		[],
	);

	const handleDragEnd = useCallback(() => {
		setDragState(null);
		siblingOriginalRatios.current.clear();
		document.documentElement.classList.remove("tiling-panel-dragging");
	}, []);

	const handleDrop = useCallback(
		(targetPanelId: SectionId, zone: DropZone) => {
			if (!dragState) return;
			const { draggedPanelId } = dragState;

			if (draggedPanelId === targetPanelId) {
				handleDragEnd();
				return;
			}

			const currentTree = layoutRef.current;
			let newTree: LayoutNode;
			if (zone === "center") {
				newTree = swapPanels(currentTree, draggedPanelId, targetPanelId);
			} else {
				const treeWithout = removePanel(currentTree, draggedPanelId);
				if (!treeWithout) {
					handleDragEnd();
					return;
				}
				newTree = insertPanel(treeWithout, targetPanelId, draggedPanelId, zone);
			}

			onLayoutChange(newTree);
			handleDragEnd();
		},
		[dragState, onLayoutChange, handleDragEnd],
	);

	useEffect(() => {
		if (!dragState) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") handleDragEnd();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [dragState, handleDragEnd]);

	useEffect(() => {
		if (!dragState) return;
		const handleMouseUp = () => handleDragEnd();
		document.addEventListener("mouseup", handleMouseUp);
		return () => document.removeEventListener("mouseup", handleMouseUp);
	}, [dragState, handleDragEnd]);

	const makeRatioHandler = useCallback(
		(path: number[]) => (newRatio: number) => {
			const newTree = updateRatioAtPath(layoutRef.current, path, newRatio);
			onLayoutChange(newTree);
		},
		[onLayoutChange],
	);

	const makeShiftDragHandler = useCallback(
		(depth: number, direction: "horizontal" | "vertical", ownPath: number[]) =>
			(delta: number) => {
				const paths = collectSplitsAtDepth(layoutRef.current, depth, direction);
				const siblingPaths = paths.filter(
					(p) => JSON.stringify(p) !== JSON.stringify(ownPath),
				);

				for (const path of siblingPaths) {
					const key = JSON.stringify(path);
					if (!siblingOriginalRatios.current.has(key)) {
						const ratio = getRatioAtPath(layoutRef.current, path);
						if (ratio !== null) {
							siblingOriginalRatios.current.set(key, ratio);
						}
					}
				}

				let newTree = layoutRef.current;
				for (const path of siblingPaths) {
					const key = JSON.stringify(path);
					const original = siblingOriginalRatios.current.get(key);
					if (original !== undefined) {
						newTree = updateRatioAtPath(newTree, path, original + delta);
					}
				}
				onLayoutChange(newTree);
			},
		[onLayoutChange],
	);

	function renderNode(node: LayoutNode, path: number[] = [], depth: number = 0): ReactNode {
		if (node.type === "leaf") {
			const isDraggedPanel = dragState?.draggedPanelId === node.panelId;
			return (
				<div
					className={`tile-leaf-wrapper${isDraggedPanel ? " tile-leaf--dragging" : ""}`}
					key={node.panelId}
				>
					<TileLeaf
						panelId={node.panelId}
						draggable={isDraggable && !dragState}
						onDragStart={handleDragStart}
						timeMode={timeMode}
					>
						{panels[node.panelId]}
					</TileLeaf>
					{dragState && dragState.draggedPanelId !== node.panelId && (
						<DragOverlay
							active={true}
							onDrop={(zone) => handleDrop(node.panelId, zone)}
						/>
					)}
				</div>
			);
		}

		const showShiftHighlight = shiftHeld;

		return (
			<TileSplit
				key={`split-${path.join("-")}`}
				direction={node.direction}
				ratio={node.ratio}
				firstChild={renderNode(node.children[0], [...path, 0], depth + 1)}
				secondChild={renderNode(node.children[1], [...path, 1], depth + 1)}
				onRatioChange={makeRatioHandler(path)}
				onShiftDrag={makeShiftDragHandler(depth, node.direction, path)}
				shiftHighlight={showShiftHighlight}
			/>
		);
	}

	return (
		<div ref={containerRef} className="tiling-container">
			{renderNode(layout)}
		</div>
	);
}
