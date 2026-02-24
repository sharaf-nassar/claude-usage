import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";

function TitleBar({
  showLive,
  showAnalytics,
  onToggleLive,
  onToggleAnalytics,
  onClose,
  pendingUpdate,
  updating,
  onUpdate,
}) {
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
        </div>
      </div>
      {pendingUpdate ? (
        <button
          className="titlebar-update-btn"
          onClick={onUpdate}
          disabled={updating}
          aria-label={`Update to version ${pendingUpdate.version}`}
        >
          {updating ? "Updating..." : `Update ${pendingUpdate.version}`}
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
