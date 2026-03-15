import type { LayoutNode, LayoutLeaf, SectionId, DropZone } from "./types";

// ── Queries ──

export function collectPanels(node: LayoutNode): SectionId[] {
	if (node.type === "leaf") return [node.panelId];
	return [...collectPanels(node.children[0]), ...collectPanels(node.children[1])];
}

export function hasPanel(node: LayoutNode, panelId: SectionId): boolean {
	if (node.type === "leaf") return node.panelId === panelId;
	return hasPanel(node.children[0], panelId) || hasPanel(node.children[1], panelId);
}

export function countLeaves(node: LayoutNode): number {
	if (node.type === "leaf") return 1;
	return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

export function findLargestLeaf(
	node: LayoutNode,
	containerWidth: number,
	containerHeight: number,
): { panelId: SectionId; width: number; height: number } {
	if (node.type === "leaf") {
		return { panelId: node.panelId, width: containerWidth, height: containerHeight };
	}

	const { direction, ratio, children } = node;
	let firstW: number, firstH: number, secondW: number, secondH: number;

	if (direction === "horizontal") {
		firstW = containerWidth * ratio;
		firstH = containerHeight;
		secondW = containerWidth * (1 - ratio);
		secondH = containerHeight;
	} else {
		firstW = containerWidth;
		firstH = containerHeight * ratio;
		secondW = containerWidth;
		secondH = containerHeight * (1 - ratio);
	}

	const first = findLargestLeaf(children[0], firstW, firstH);
	const second = findLargestLeaf(children[1], secondW, secondH);

	return first.width * first.height >= second.width * second.height ? first : second;
}

export function collectSplitsAtDepth(
	node: LayoutNode,
	targetDepth: number,
	targetDirection: "horizontal" | "vertical",
	currentDepth: number = 0,
): number[][] {
	if (node.type === "leaf") return [];
	if (currentDepth === targetDepth && node.direction === targetDirection) {
		return [[]];
	}
	if (currentDepth >= targetDepth) return [];

	const leftPaths = collectSplitsAtDepth(
		node.children[0], targetDepth, targetDirection, currentDepth + 1,
	).map((p) => [0, ...p]);
	const rightPaths = collectSplitsAtDepth(
		node.children[1], targetDepth, targetDirection, currentDepth + 1,
	).map((p) => [1, ...p]);

	return [...leftPaths, ...rightPaths];
}

export function getDepthOfPanel(
	node: LayoutNode,
	panelId: SectionId,
	currentDepth: number = 0,
): number | null {
	if (node.type === "leaf") return node.panelId === panelId ? currentDepth : null;
	const left = getDepthOfPanel(node.children[0], panelId, currentDepth + 1);
	if (left !== null) return left;
	return getDepthOfPanel(node.children[1], panelId, currentDepth + 1);
}

// ── Mutations (all return new trees, never mutate) ──

export function removePanel(node: LayoutNode, panelId: SectionId): LayoutNode | null {
	if (node.type === "leaf") {
		return node.panelId === panelId ? null : node;
	}

	const leftResult = removePanel(node.children[0], panelId);
	const rightResult = removePanel(node.children[1], panelId);

	if (leftResult === null) return rightResult;
	if (rightResult === null) return leftResult;

	if (leftResult === node.children[0] && rightResult === node.children[1]) {
		return node;
	}

	return {
		type: "split",
		direction: node.direction,
		ratio: node.ratio,
		children: [leftResult, rightResult],
	};
}

export function insertPanel(
	tree: LayoutNode,
	targetPanelId: SectionId,
	newPanelId: SectionId,
	zone: DropZone,
): LayoutNode {
	if (zone === "center") {
		return swapPanels(tree, targetPanelId, newPanelId);
	}
	return insertAtLeaf(tree, targetPanelId, newPanelId, zone);
}

function insertAtLeaf(
	node: LayoutNode,
	targetPanelId: SectionId,
	newPanelId: SectionId,
	zone: DropZone,
): LayoutNode {
	if (node.type === "leaf") {
		if (node.panelId !== targetPanelId) return node;

		const newLeaf: LayoutLeaf = { type: "leaf", panelId: newPanelId };
		const direction: "horizontal" | "vertical" =
			zone === "left" || zone === "right" ? "horizontal" : "vertical";
		const newFirst = zone === "left" || zone === "top" ? newLeaf : node;
		const newSecond = zone === "left" || zone === "top" ? node : newLeaf;

		return {
			type: "split",
			direction,
			ratio: 0.5,
			children: [newFirst, newSecond],
		};
	}

	return {
		type: "split",
		direction: node.direction,
		ratio: node.ratio,
		children: [
			insertAtLeaf(node.children[0], targetPanelId, newPanelId, zone),
			insertAtLeaf(node.children[1], targetPanelId, newPanelId, zone),
		],
	};
}

export function swapPanels(
	node: LayoutNode,
	panelA: SectionId,
	panelB: SectionId,
): LayoutNode {
	if (node.type === "leaf") {
		if (node.panelId === panelA) return { type: "leaf", panelId: panelB };
		if (node.panelId === panelB) return { type: "leaf", panelId: panelA };
		return node;
	}

	return {
		type: "split",
		direction: node.direction,
		ratio: node.ratio,
		children: [
			swapPanels(node.children[0], panelA, panelB),
			swapPanels(node.children[1], panelA, panelB),
		],
	};
}

export function smartInsert(
	tree: LayoutNode,
	newPanelId: SectionId,
	containerWidth: number,
	containerHeight: number,
): LayoutNode {
	const largest = findLargestLeaf(tree, containerWidth, containerHeight);
	const zone: DropZone = largest.width >= largest.height ? "right" : "bottom";
	return insertPanel(tree, largest.panelId, newPanelId, zone);
}

export function getRatioAtPath(node: LayoutNode, path: number[]): number | null {
	if (path.length === 0) {
		return node.type === "split" ? node.ratio : null;
	}
	if (node.type !== "split") return null;
	const [head, ...rest] = path;
	return getRatioAtPath(node.children[head as 0 | 1], rest);
}

export function updateRatioAtPath(
	node: LayoutNode,
	path: number[],
	newRatio: number,
): LayoutNode {
	const clamped = Math.max(0.05, Math.min(0.95, newRatio));
	if (path.length === 0) {
		if (node.type !== "split") return node;
		return { ...node, ratio: clamped };
	}

	if (node.type !== "split") return node;

	const [head, ...rest] = path;
	const newChildren: [LayoutNode, LayoutNode] = [
		head === 0 ? updateRatioAtPath(node.children[0], rest, clamped) : node.children[0],
		head === 1 ? updateRatioAtPath(node.children[1], rest, clamped) : node.children[1],
	];

	return { ...node, children: newChildren };
}

export function pruneUnknownPanels(
	node: LayoutNode,
	knownPanels: Set<SectionId>,
): LayoutNode | null {
	if (node.type === "leaf") {
		return knownPanels.has(node.panelId) ? node : null;
	}

	const left = pruneUnknownPanels(node.children[0], knownPanels);
	const right = pruneUnknownPanels(node.children[1], knownPanels);

	if (left === null) return right;
	if (right === null) return left;

	return {
		type: "split",
		direction: node.direction,
		ratio: node.ratio,
		children: [left, right],
	};
}

// ── Persistence ──

const LAST_LAYOUT_KEY = "quill-last-layout";
const POSITION_MEMORY_KEY = "quill-position-memory";
const PRESETS_KEY = "quill-layout-presets";

export function saveLastLayout(tree: LayoutNode, visiblePanels: SectionId[]): void {
	try {
		localStorage.setItem(LAST_LAYOUT_KEY, JSON.stringify({ tree, visiblePanels }));
	} catch { /* ignore */ }
}

export function loadLastLayout(): { tree: LayoutNode; visiblePanels: SectionId[] } | null {
	try {
		const stored = localStorage.getItem(LAST_LAYOUT_KEY);
		if (stored) return JSON.parse(stored);
	} catch { /* ignore */ }
	return null;
}

export function savePositionMemory(
	panelId: SectionId,
	snapshot: LayoutNode,
	visiblePanels: SectionId[],
): void {
	try {
		const current = loadAllPositionMemory();
		current[panelId] = { snapshot, visiblePanels, timestamp: Date.now() };
		localStorage.setItem(POSITION_MEMORY_KEY, JSON.stringify(current));
	} catch { /* ignore */ }
}

export function loadAllPositionMemory(): Record<string, {
	snapshot: LayoutNode;
	visiblePanels: SectionId[];
	timestamp: number;
}> {
	try {
		const stored = localStorage.getItem(POSITION_MEMORY_KEY);
		if (stored) return JSON.parse(stored);
	} catch { /* ignore */ }
	return {};
}

export function saveCustomPresets(
	presets: Record<string, { tree: LayoutNode; visiblePanels: SectionId[]; createdAt: number }>,
): void {
	try {
		localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
	} catch { /* ignore */ }
}

export function loadCustomPresets(): Record<string, {
	tree: LayoutNode;
	visiblePanels: SectionId[];
	createdAt: number;
}> {
	try {
		const stored = localStorage.getItem(PRESETS_KEY);
		if (stored) return JSON.parse(stored);
	} catch { /* ignore */ }
	return {};
}

export function isSnapshotCompatible(
	snapshotPanels: SectionId[],
	currentlyVisible: SectionId[],
	activating: SectionId,
): boolean {
	const allowed = new Set([...currentlyVisible, activating]);
	return snapshotPanels.every((p) => allowed.has(p));
}

export function removeLegacyKeys(): void {
	const legacy = [
		"quill-split-ratio",
		"quill-size-live",
		"quill-size-analytics",
		"quill-size-both",
	];
	for (const key of legacy) {
		try { localStorage.removeItem(key); } catch { /* ignore */ }
	}
}
