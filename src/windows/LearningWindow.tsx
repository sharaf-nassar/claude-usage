import { useState, useRef, useEffect } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { useLearningData } from "../hooks/useLearningData";
import StatusStrip from "../components/learning/StatusStrip";
import RuleCard from "../components/learning/RuleCard";
import DomainBreakdown from "../components/learning/DomainBreakdown";
import RunHistory from "../components/learning/RunHistory";
import type { LearningSettings } from "../types";

type LearningTab = "summary" | "rules" | "runs";

const TRIGGER_OPTIONS = [
  { value: "on-demand", label: "On-demand" },
  { value: "session-end", label: "Session end" },
  { value: "periodic", label: "Periodic" },
  { value: "session-end+periodic", label: "Both" },
] as const;

interface LearningSettingsInlineProps {
  settings: LearningSettings;
  onUpdateSettings: (settings: LearningSettings) => void;
}

function LearningSettingsInline({
  settings,
  onUpdateSettings,
}: LearningSettingsInlineProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const showInterval =
    settings.trigger_mode === "periodic" ||
    settings.trigger_mode === "session-end+periodic";

  return (
    <div className="learning-cog-wrap" ref={ref}>
      <button
        className="learning-cog-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Learning settings"
      >
        &#9881;
      </button>
      {open && (
        <div className="learning-cog-menu">
          <div className="learning-cog-menu-header">TRIGGER MODE</div>
          {TRIGGER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`learning-cog-menu-item${settings.trigger_mode === opt.value ? " active" : ""}`}
              onClick={() =>
                onUpdateSettings({ ...settings, trigger_mode: opt.value })
              }
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
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 10) {
                    onUpdateSettings({ ...settings, periodic_minutes: val });
                  }
                }}
                min={10}
                max={1440}
              />
              <span>min</span>
            </div>
          )}
          <div className="learning-cog-menu-header">MIN CONFIDENCE</div>
          <div className="learning-cog-interval">
            <input
              type="number"
              className="learning-interval-input"
              value={settings.min_confidence}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 0 && val <= 1) {
                  onUpdateSettings({ ...settings, min_confidence: val });
                }
              }}
              min={0}
              max={1}
              step={0.05}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function LearningPanel() {
  const {
    settings,
    rules,
    runs,
    observationCount,
    unanalyzedCount,
    topTools,
    sparkline,
    analyzing,
    liveLogs,
    loading,
    updateSettings,
    triggerAnalysis,
    deleteRule,
  } = useLearningData();

  const [activeTab, setActiveTab] = useState<LearningTab>("summary");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const grow = async () => {
      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow <= 0) return;

      const win = getCurrentWindow();
      const size = await win.innerSize();
      const maxH = window.screen.availHeight * 0.85;
      const newH = Math.min(size.height + overflow, maxH);
      if (newH > size.height) {
        await win.setSize(new LogicalSize(size.width, Math.round(newH)));
      }
    };

    const observer = new ResizeObserver(() => {
      grow();
    });
    observer.observe(el);
    grow();

    return () => observer.disconnect();
  });

  const handleToggleEnabled = (on: boolean) => {
    updateSettings({ ...settings, enabled: on });
  };

  if (loading) {
    return (
      <div className="learning-app">
        <div className="learning-toolbar">
          <div className="learning-tabs">
            <button className="learning-tab active">Summary</button>
            <button className="learning-tab">Rules</button>
            <button className="learning-tab">Runs</button>
          </div>
        </div>
        <div className="learning-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="learning-app">
      <div className="learning-toolbar">
        <div className="learning-tabs">
          {(["summary", "rules", "runs"] as const).map((tab) => (
            <button
              key={tab}
              className={`learning-tab${activeTab === tab ? " active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "summary"
                ? "Summary"
                : tab === "rules"
                  ? `Rules (${rules.length})`
                  : `Runs (${runs.length})`}
            </button>
          ))}
        </div>
        <div className="learning-toolbar-right">
          {settings.trigger_mode !== "on-demand" && (
            <button
              className={`learning-toggle${settings.enabled ? " learning-toggle--on" : ""}`}
              onClick={() => handleToggleEnabled(!settings.enabled)}
              aria-label={
                settings.enabled ? "Disable learning" : "Enable learning"
              }
            >
              <span className="learning-toggle-dot" />
              {settings.enabled ? "ON" : "OFF"}
            </button>
          )}
          <LearningSettingsInline
            settings={settings}
            onUpdateSettings={updateSettings}
          />
        </div>
      </div>
      <div className="learning-content" ref={contentRef}>
        {activeTab === "summary" && (
          <StatusStrip
            observationCount={observationCount}
            unanalyzedCount={unanalyzedCount}
            topTools={topTools}
            sparkline={sparkline}
            lastRun={runs[0]}
            analyzing={analyzing}
            onAnalyze={triggerAnalysis}
          />
        )}
        {activeTab === "rules" && (
          <div className="learning-section">
            {rules.length === 0 ? (
              <div className="learning-empty">
                No rules learned yet. Run an analysis to get started.
              </div>
            ) : (
              <>
                {rules.map((rule) => (
                  <RuleCard key={rule.name} rule={rule} onDelete={deleteRule} />
                ))}
                <DomainBreakdown rules={rules} />
              </>
            )}
          </div>
        )}
        {activeTab === "runs" && (
          <RunHistory runs={runs} analyzing={analyzing} liveLogs={liveLogs} />
        )}
      </div>
    </div>
  );
}

export default LearningPanel;
