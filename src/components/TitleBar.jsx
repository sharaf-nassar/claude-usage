import { getCurrentWindow } from "@tauri-apps/api/window";

function TitleBar() {
  const handleClose = async () => {
    await getCurrentWindow().close();
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <span className="titlebar-text" data-tauri-drag-region>
        CLAUDE USAGE
      </span>
      <button className="titlebar-close" onClick={handleClose}>
        &times;
      </button>
    </div>
  );
}

export default TitleBar;
