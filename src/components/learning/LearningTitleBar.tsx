import { useState, useRef, useEffect } from "react";
import type { LearningSettings } from "../../types";

interface LearningTitleBarProps {
  enabled: boolean;
  settings: LearningSettings;
  onToggleEnabled: (on: boolean) => void;
  onUpdateSettings: (settings: LearningSettings) => void;
}

const TRIGGER_OPTIONS = [
  { value: "on-demand", label: "On-demand only" },
  { value: "session-end", label: "Session end" },
  { value: "periodic", label: "Periodic" },
  { value: "session-end+periodic", label: "Session end + Periodic" },
] as const;

function LearningTitleBar({
  enabled,
  settings,
  onToggleEnabled,
  onUpdateSettings,
}: LearningTitleBarProps) {
  const [showCog, setShowCog] = useState(false);
  const cogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showCog) return;
    const handleClick = (e: MouseEvent) => {
      if (cogRef.current && !cogRef.current.contains(e.target as Node)) {
        setShowCog(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCog]);

  const showInterval =
    settings.trigger_mode === "periodic" ||
    settings.trigger_mode === "session-end+periodic";

  const handleTriggerChange = (mode: string) => {
    onUpdateSettings({ ...settings, trigger_mode: mode });
  };

  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 10) {
      onUpdateSettings({ ...settings, periodic_minutes: val });
    }
  };

  return (
    <div className="learning-titlebar">
      <span className="learning-titlebar-icon">&#10022;</span>
      <span className="learning-titlebar-title">LEARNING</span>
      <button
        className={`learning-toggle${enabled ? " learning-toggle--on" : ""}`}
        onClick={() => onToggleEnabled(!enabled)}
        aria-label={enabled ? "Disable learning" : "Enable learning"}
      >
        <span className="learning-toggle-dot" />
        {enabled ? "ON" : "OFF"}
      </button>
      <div className="learning-cog-wrap" ref={cogRef}>
        <button
          className="learning-cog-btn"
          onClick={() => setShowCog((v) => !v)}
          aria-label="Trigger settings"
        >
          &#9881;
        </button>
        {showCog && (
          <div className="learning-cog-menu">
            <div className="learning-cog-menu-header">TRIGGER MODE</div>
            {TRIGGER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`learning-cog-menu-item${settings.trigger_mode === opt.value ? " active" : ""}`}
                onClick={() => handleTriggerChange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
            {showInterval && (
              <div className="learning-cog-interval">
                <span>Every</span>
                <input
                  type="number"
                  className="learning-interval-input"
                  value={settings.periodic_minutes}
                  onChange={handleIntervalChange}
                  min={10}
                  max={1440}
                />
                <span>min</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default LearningTitleBar;
