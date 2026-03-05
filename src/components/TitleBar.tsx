import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { PendingUpdate } from "../types";

interface TitleBarProps {
  showLive: boolean;
  showAnalytics: boolean;
  showLearning: boolean;
  onToggleLive: (on: boolean) => void;
  onToggleAnalytics: (on: boolean) => void;
  onToggleLearning: () => void;
  onClose: () => void;
  pendingUpdate: PendingUpdate | null;
  updating: boolean;
  onUpdate: () => void;
}

function TitleBar({
  showLive,
  showAnalytics,
  showLearning,
  onToggleLive,
  onToggleAnalytics,
  onToggleLearning,
  onClose,
  pendingUpdate,
  updating,
  onUpdate,
}: TitleBarProps) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left">
        <div className="view-toggle">
          <button
            className={`view-tab${showLive ? " active" : ""}`}
            onClick={() => onToggleLive(!showLive)}
          >
            Live
          </button>
          <button
            className={`view-tab${showAnalytics ? " active" : ""}`}
            onClick={() => onToggleAnalytics(!showAnalytics)}
          >
            Analytics
          </button>
          <button
            className={`view-tab view-tab--learning${showLearning ? " active" : ""}`}
            onClick={onToggleLearning}
          >
            &#10022;
          </button>
        </div>
      </div>
      {pendingUpdate ? (
        <button
          className="titlebar-update-btn"
          onClick={onUpdate}
          disabled={updating}
          aria-label={`Update to version ${pendingUpdate.version}`}
        >
          {updating ? "Updating\u2026" : `Update ${pendingUpdate.version}`}
        </button>
      ) : (
        <span className="titlebar-text" data-tauri-drag-region>
          CLAUDE USAGE
        </span>
      )}
      {version && <span className="titlebar-version">v{version}</span>}
      <button
        className="titlebar-close"
        onClick={onClose}
        aria-label="Close window"
      >
        &times;
      </button>
    </div>
  );
}

export default TitleBar;
