import { useState, useCallback, useRef, useEffect } from "react";
import type { LayoutNode, SectionId } from "./types";
import { BUILTIN_PRESET_IDS, BUILTIN_PRESET_LABELS, generatePreset } from "./presets";
import { loadCustomPresets, saveCustomPresets } from "./layoutEngine";

interface PresetsMenuProps {
	layout: LayoutNode;
	visiblePanels: SectionId[];
	onApplyPreset: (tree: LayoutNode) => void;
}

export default function PresetsMenu({
	layout,
	visiblePanels,
	onApplyPreset,
}: PresetsMenuProps) {
	const [open, setOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveName, setSaveName] = useState("");
	const [customPresets, setCustomPresets] = useState(() => loadCustomPresets());
	const menuRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!open) return;
		const handleClick = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setOpen(false);
				setSaving(false);
			}
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [open]);

	useEffect(() => {
		if (saving && inputRef.current) inputRef.current.focus();
	}, [saving]);

	const handleBuiltinSelect = useCallback(
		(presetId: string) => {
			const tree = generatePreset(
				presetId as Parameters<typeof generatePreset>[0],
				visiblePanels,
			);
			if (tree) onApplyPreset(tree);
			setOpen(false);
		},
		[visiblePanels, onApplyPreset],
	);

	const handleCustomSelect = useCallback(
		(name: string) => {
			const preset = customPresets[name];
			if (!preset) return;
			onApplyPreset(preset.tree);
			setOpen(false);
		},
		[customPresets, onApplyPreset],
	);

	const handleSave = useCallback(() => {
		const name = saveName.trim();
		if (!name) return;
		const updated = {
			...customPresets,
			[name]: { tree: layout, visiblePanels, createdAt: Date.now() },
		};
		saveCustomPresets(updated);
		setCustomPresets(updated);
		setSaveName("");
		setSaving(false);
	}, [saveName, layout, visiblePanels, customPresets]);

	const handleDelete = useCallback(
		(name: string, e: React.MouseEvent) => {
			e.stopPropagation();
			const updated = { ...customPresets };
			delete updated[name];
			saveCustomPresets(updated);
			setCustomPresets(updated);
		},
		[customPresets],
	);

	const nameExists = saveName.trim() in customPresets;
	const customNames = Object.keys(customPresets);

	return (
		<div ref={menuRef} style={{ position: "relative", display: "inline-block" }}>
			<button
				className="presets-button"
				onClick={() => setOpen((o) => !o)}
				title="Layout presets"
				aria-label="Layout presets"
			>
				&#9638;
			</button>

			{open && (
				<div className="presets-dropdown">
					{BUILTIN_PRESET_IDS.map((id) => (
						<button
							key={id}
							className="presets-dropdown-item"
							onClick={() => handleBuiltinSelect(id)}
							disabled={visiblePanels.length === 0}
						>
							{BUILTIN_PRESET_LABELS[id]}
						</button>
					))}

					{customNames.length > 0 && <div className="presets-dropdown-divider" />}

					{customNames.map((name) => (
						<div key={name} style={{ display: "flex", alignItems: "center" }}>
							<button
								className="presets-dropdown-item"
								style={{ flex: 1 }}
								onClick={() => handleCustomSelect(name)}
							>
								{name}
							</button>
							<button
								className="presets-dropdown-item presets-dropdown-item--delete"
								onClick={(e) => handleDelete(name, e)}
								title="Delete preset"
							>
								&times;
							</button>
						</div>
					))}

					<div className="presets-dropdown-divider" />

					{saving ? (
						<div className="presets-save-row">
							<input
								ref={inputRef}
								className="presets-save-input"
								value={saveName}
								onChange={(e) => setSaveName(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleSave();
									if (e.key === "Escape") setSaving(false);
								}}
								placeholder="Preset name..."
							/>
							<button
								className="presets-save-btn"
								onClick={handleSave}
								disabled={!saveName.trim()}
							>
								{nameExists ? "Overwrite" : "Save"}
							</button>
						</div>
					) : (
						<button
							className="presets-dropdown-item"
							onClick={() => setSaving(true)}
							disabled={visiblePanels.length === 0}
						>
							Save current layout...
						</button>
					)}
				</div>
			)}
		</div>
	);
}
