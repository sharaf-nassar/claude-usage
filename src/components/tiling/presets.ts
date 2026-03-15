import type { LayoutNode, LayoutLeaf, SectionId, BuiltinPresetId } from "./types";

function leaf(panelId: SectionId): LayoutLeaf {
	return { type: "leaf", panelId };
}

function buildStack(
	panels: SectionId[],
	direction: "horizontal" | "vertical",
): LayoutNode {
	if (panels.length === 1) return leaf(panels[0]);
	if (panels.length === 2) {
		return {
			type: "split",
			direction,
			ratio: 0.5,
			children: [leaf(panels[0]), leaf(panels[1])],
		};
	}

	const ratio = 1 / panels.length;
	return {
		type: "split",
		direction,
		ratio,
		children: [leaf(panels[0]), buildStack(panels.slice(1), direction)],
	};
}

function verticalStack(panels: SectionId[]): LayoutNode {
	return buildStack(panels, "vertical");
}

function horizontalRow(panels: SectionId[]): LayoutNode {
	return buildStack(panels, "horizontal");
}

function mainSidebar(panels: SectionId[]): LayoutNode {
	if (panels.length === 1) return leaf(panels[0]);
	return {
		type: "split",
		direction: "horizontal",
		ratio: 0.6,
		children: [leaf(panels[0]), buildStack(panels.slice(1), "vertical")],
	};
}

function sidebarMain(panels: SectionId[]): LayoutNode {
	if (panels.length === 1) return leaf(panels[0]);
	const last = panels[panels.length - 1];
	const rest = panels.slice(0, -1);
	return {
		type: "split",
		direction: "horizontal",
		ratio: 0.4,
		children: [buildStack(rest, "vertical"), leaf(last)],
	};
}

function grid(panels: SectionId[]): LayoutNode {
	if (panels.length <= 2) return horizontalRow(panels);

	const half = Math.ceil(panels.length / 2);
	const leftCol = panels.slice(0, half);
	const rightCol = panels.slice(half);

	if (rightCol.length === 0) return horizontalRow(leftCol);

	return {
		type: "split",
		direction: "horizontal",
		ratio: 0.5,
		children: [
			buildStack(leftCol, "vertical"),
			buildStack(rightCol, "vertical"),
		],
	};
}

const GENERATORS: Record<BuiltinPresetId, (panels: SectionId[]) => LayoutNode> = {
	"vertical-stack": verticalStack,
	"horizontal-row": horizontalRow,
	"main-sidebar": mainSidebar,
	"sidebar-main": sidebarMain,
	grid,
};

export const BUILTIN_PRESET_LABELS: Record<BuiltinPresetId, string> = {
	"vertical-stack": "Vertical Stack",
	"horizontal-row": "Horizontal Row",
	"main-sidebar": "Main + Sidebar",
	"sidebar-main": "Sidebar + Main",
	grid: "Grid",
};

export const BUILTIN_PRESET_IDS: BuiltinPresetId[] = [
	"vertical-stack",
	"horizontal-row",
	"main-sidebar",
	"sidebar-main",
	"grid",
];

export function generatePreset(
	presetId: BuiltinPresetId,
	visiblePanels: SectionId[],
): LayoutNode | null {
	if (visiblePanels.length === 0) return null;
	return GENERATORS[presetId](visiblePanels);
}
