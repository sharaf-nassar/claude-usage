function TitleBar({
  showLive,
  showAnalytics,
  onToggleLive,
  onToggleAnalytics,
  onClose,
}) {
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
      <span className="titlebar-text" data-tauri-drag-region>
        CLAUDE USAGE
      </span>
      <button className="titlebar-close" onClick={onClose}>
        &times;
      </button>
    </div>
  );
}

export default TitleBar;
