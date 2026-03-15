import type { SectionId } from "../../types";

export type { SectionId };

export type LayoutLeaf = {
	type: "leaf";
	panelId: SectionId;
};

export type LayoutSplit = {
	type: "split";
	direction: "horizontal" | "vertical";
	ratio: number;
	children: [LayoutNode, LayoutNode];
};

export type LayoutNode = LayoutLeaf | LayoutSplit;

export type PositionMemoryEntry = {
	snapshot: LayoutNode;
	visiblePanels: SectionId[];
	timestamp: number;
};

export type PositionMemory = Record<string, PositionMemoryEntry>;

export type SavedLayout = {
	tree: LayoutNode;
	visiblePanels: SectionId[];
};

export type CustomPreset = {
	tree: LayoutNode;
	visiblePanels: SectionId[];
	createdAt: number;
};

export type BuiltinPresetId =
	| "vertical-stack"
	| "horizontal-row"
	| "main-sidebar"
	| "sidebar-main"
	| "grid";

export type DropZone = "top" | "bottom" | "left" | "right" | "center";

export type DragState = {
	draggedPanelId: SectionId;
	sourceTree: LayoutNode;
} | null;
