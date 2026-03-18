# Separate Learning into Standalone Window

## Purpose

Remove the Learning section from the tiling panel system and make it a standalone Tauri window, matching the existing Sessions window pattern.

## Current State

- Learning is a tiling panel (`SectionId = "learning"`) rendered inside the main tiling grid
- Sessions is a standalone Tauri window routed via `?view=sessions` in `main.tsx`
- A button (✦) already exists in the title bar to open Learning, currently calling `onToggleSection("learning")`

## Changes

### 1. Remove `"learning"` from `SectionId`

In `src/types.ts`, change:
```typescript
export type SectionId = "live" | "analytics";
```

This cascades to all tiling-related code that references `SectionId`.

### 2. Add `?view=learning` route in `main.tsx`

Add a lazy import for `LearningWindow` and a route case matching the Sessions pattern:
- `?view=learning` renders `LearningWindow` as a standalone view
- Same lazy-loading pattern as `SessionsWindowView` and `RunsWindowView`

### 3. Convert `LearningWindow.tsx` to standalone window

Refactor the existing `LearningPanel` export to a standalone window view:
- Add its own title bar with close button (matching `SessionsWindowView` pattern)
- Use `getCurrentWindow()` from `@tauri-apps/api/window` for window management (close)
- Remove tiling-specific patterns (it no longer lives inside a `TileLeaf`)
- Keep all existing internal components (StatusStrip, RuleCard, MemoriesPanel, FloatingRunsWindow)
- Import `learning.css` directly (it's currently imported by `App.tsx` — move the import here)
- The component fills the full window
- The existing auto-resize logic (`win.setSize()`) that was designed for the tiling context should be removed or adapted, since the learning window now owns its own size

### 4. Update `App.tsx`

Remove all learning-related code:
- Remove `import LearningPanel` (line 9)
- Remove `import "./styles/learning.css"` (line 27) — moves to `LearningWindow.tsx`
- Remove `"learning"` from `KNOWN_PANELS` set (line 34)
- Remove `SHOW_LEARNING_KEY` constant and its `localStorage.setItem` in the layout persistence `useEffect`
- Remove `showLearning` derived variable (line 95)
- Remove learning from `buildInitialLayout()` — no longer pushes `"learning"` into initial panels
- Remove learning from `panelMap` — becomes `Record<SectionId, ReactNode>` with only `live` and `analytics`
- Stop passing `showLearning` to `TitleBar`

### 5. Update `TitleBar.tsx`

- Remove `showLearning` prop from `TitleBarProps`
- Change the ✦ button from `onClick={() => onToggleSection("learning")}` to a new `handleOpenLearning` handler
- `handleOpenLearning` follows the exact same pattern as `handleOpenSessions`: check for existing window by label, show+focus if exists, otherwise create new `WebviewWindow("learning", { url: "/?view=learning", ... })`
- Remove the `active` class toggle on the ✦ button (it's no longer a toggle — it just opens the window)

### 6. Update tiling system

- `TileLeaf.tsx`: Remove `"learning"` from `PANEL_LABELS`
- `presets.ts`: Update default visible panels to only `"live"` and `"analytics"`

### 7. No `tauri.conf.json` changes needed

The learning window is created dynamically via `WebviewWindow` in JS (same as sessions), no Tauri config entry required.

## Out of Scope

- No changes to the Learning section's internal functionality
- No visual redesign of the Learning content itself
- No changes to the Sessions window
