import { useEffect } from "react";
import {
	getCurrentWindow,
	currentMonitor,
	LogicalPosition,
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const RUNS_WIDTH = 320;
const RUNS_HEIGHT = 400;
const GAP = 8;

interface FloatingRunsWindowProps {
	onClose: () => void;
}

async function calcPosition(): Promise<{ x: number; y: number }> {
	const parent = getCurrentWindow();
	const scale = await parent.scaleFactor();
	const physPos = await parent.outerPosition();
	const physSize = await parent.outerSize();
	const monitor = await currentMonitor();

	// Convert physical pixels to logical coordinates
	const pos = physPos.toLogical(scale);
	const sizeW = physSize.width / scale;
	const sizeH = physSize.height / scale;

	const parentRight = pos.x + sizeW;
	const parentBottom = pos.y + sizeH;

	// Align bottom of runs window with bottom of parent
	const y = parentBottom - RUNS_HEIGHT;

	if (monitor) {
		const monScale = monitor.scaleFactor;
		const monX = monitor.position.x / monScale;
		const monRight = monX + monitor.size.width / monScale;
		const spaceRight = monRight - parentRight;
		const spaceLeft = pos.x - monX;

		// Prefer right side; fall back to left if not enough room
		if (spaceRight >= RUNS_WIDTH + GAP) {
			return { x: parentRight + GAP, y };
		}
		if (spaceLeft >= RUNS_WIDTH + GAP) {
			return { x: pos.x - RUNS_WIDTH - GAP, y };
		}
	}

	// Default: right side of parent
	return { x: parentRight + GAP, y };
}

function FloatingRunsWindow({ onClose }: FloatingRunsWindowProps) {
	useEffect(() => {
		let cancelled = false;

		(async () => {
			const existing = await WebviewWindow.getByLabel("runs");
			if (cancelled) return;

			if (existing) {
				const { x, y } = await calcPosition();
				if (cancelled) return;
				await existing.setPosition(new LogicalPosition(x, y));
				await existing.show();
				await existing.setFocus();
				return;
			}

			const { x, y } = await calcPosition();
			if (cancelled) return;

			const win = new WebviewWindow("runs", {
				url: "/?view=runs",
				title: "Run History",
				width: RUNS_WIDTH,
				height: RUNS_HEIGHT,
				x,
				y,
				minWidth: 240,
				minHeight: 200,
				decorations: false,
				transparent: true,
				resizable: true,
				alwaysOnTop: true,
			});

			win.once("tauri://error", () => {
				onClose();
			});
		})();

		return () => {
			cancelled = true;
			WebviewWindow.getByLabel("runs").then((w) => w?.destroy());
		};
	}, [onClose]);

	return null;
}

export default FloatingRunsWindow;
