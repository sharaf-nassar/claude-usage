import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import TitleBar from "./components/TitleBar";
import UsageDisplay from "./components/UsageDisplay";

const BASE_WIDTH = 260;
const BASE_HEIGHT = 200;

function App() {
  const [usageData, setUsageData] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const contentRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await invoke("fetch_usage_data");
      setUsageData(data);
    } catch (e) {
      setUsageData({ buckets: [], error: String(e) });
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const updateScale = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      const wScale = w / BASE_WIDTH;
      const hScale = h / BASE_HEIGHT;
      const scale = Math.max(0.6, Math.min(wScale, hScale, 2.5));
      el.style.setProperty("--s", scale);
    };

    const observer = new ResizeObserver(updateScale);
    observer.observe(el);
    updateScale();
    return () => observer.disconnect();
  }, []);

  const handleContextMenu = (e) => {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setShowMenu(true);
  };

  const closeMenu = () => setShowMenu(false);

  const handleQuit = async () => {
    closeMenu();
    await getCurrentWindow().close();
  };

  const handleRefresh = () => {
    closeMenu();
    refresh();
  };

  return (
    <div className="app" onContextMenu={handleContextMenu} onClick={closeMenu}>
      <TitleBar />
      <div className="content" ref={contentRef}>
        <UsageDisplay data={usageData} />
      </div>
      {showMenu && (
        <div
          className="context-menu"
          style={{ left: menuPos.x, top: menuPos.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="context-menu-item" onClick={handleRefresh}>
            Refresh
          </button>
          <button className="context-menu-item" onClick={handleQuit}>
            Quit
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
