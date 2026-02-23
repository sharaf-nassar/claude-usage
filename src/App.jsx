import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import TitleBar from "./components/TitleBar";
import UsageDisplay from "./components/UsageDisplay";
import AnalyticsView from "./components/analytics/AnalyticsView";

const BASE_WIDTH = 260;
const BASE_HEIGHTS = { marker: 200, dual: 250, background: 200 };
const TIME_MODE_KEY = "claude-usage-time-mode";
const SHOW_LIVE_KEY = "claude-usage-show-live";
const SHOW_ANALYTICS_KEY = "claude-usage-show-analytics";
const SIZE_PREFIX = "claude-usage-size-";

const DEFAULT_SIZES = {
  live: { width: 280, height: 340 },
  analytics: { width: 520, height: 560 },
  both: { width: 520, height: 700 },
};

function layoutKey(live, analytics) {
  if (live && analytics) return "both";
  if (live) return "live";
  if (analytics) return "analytics";
  return null;
}

function loadSize(key) {
  try {
    const stored = localStorage.getItem(SIZE_PREFIX + key);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.width > 0 && parsed.height > 0) return parsed;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SIZES[key] ?? DEFAULT_SIZES.live;
}

function saveSize(key, width, height) {
  try {
    localStorage.setItem(SIZE_PREFIX + key, JSON.stringify({ width, height }));
  } catch {
    /* ignore */
  }
}

function loadBool(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

function loadTimeMode() {
  try {
    const stored = localStorage.getItem(TIME_MODE_KEY);
    if (stored === "marker" || stored === "dual" || stored === "background") {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return "marker";
}

function App() {
  const [usageData, setUsageData] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [timeMode, setTimeMode] = useState(loadTimeMode);
  const [showLive, setShowLive] = useState(() => loadBool(SHOW_LIVE_KEY, true));
  const [showAnalytics, setShowAnalytics] = useState(() =>
    loadBool(SHOW_ANALYTICS_KEY, false),
  );
  const liveRef = useRef(null);
  const showLiveRef = useRef(showLive);
  const showAnalyticsRef = useRef(showAnalytics);
  const currentLayoutRef = useRef(
    layoutKey(
      loadBool(SHOW_LIVE_KEY, true),
      loadBool(SHOW_ANALYTICS_KEY, false),
    ),
  );

  const saveCurrentSize = useCallback(async () => {
    const key = currentLayoutRef.current;
    if (!key) return;
    try {
      const size = await getCurrentWindow().innerSize();
      saveSize(key, Math.round(size.width), Math.round(size.height));
    } catch {
      /* ignore */
    }
  }, []);

  const handleClose = useCallback(async () => {
    await saveCurrentSize();
    await getCurrentWindow().close();
  }, [saveCurrentSize]);

  const restoreSize = useCallback(async (key) => {
    if (!key) return;
    const size = loadSize(key);
    try {
      await getCurrentWindow().setSize(
        new LogicalSize(size.width, size.height),
      );
    } catch {
      /* ignore */
    }
  }, []);

  const switchLayout = useCallback(async (nextLive, nextAnalytics) => {
    const prevKey = currentLayoutRef.current;
    const nextKey = layoutKey(nextLive, nextAnalytics);

    if (prevKey) {
      try {
        const size = await getCurrentWindow().innerSize();
        saveSize(prevKey, Math.round(size.width), Math.round(size.height));
      } catch {
        /* ignore */
      }
    }

    setShowLive(nextLive);
    setShowAnalytics(nextAnalytics);
    showLiveRef.current = nextLive;
    showAnalyticsRef.current = nextAnalytics;
    currentLayoutRef.current = nextKey;
    try {
      localStorage.setItem(SHOW_LIVE_KEY, String(nextLive));
    } catch {
      /* ignore */
    }
    try {
      localStorage.setItem(SHOW_ANALYTICS_KEY, String(nextAnalytics));
    } catch {
      /* ignore */
    }

    if (nextKey) {
      const size = loadSize(nextKey);
      try {
        await getCurrentWindow().setSize(
          new LogicalSize(size.width, size.height),
        );
      } catch {
        /* ignore */
      }
    }
  }, []);

  const handleToggleLive = useCallback(
    (on) => {
      switchLayout(on, showAnalyticsRef.current);
    },
    [switchLayout],
  );

  const handleToggleAnalytics = useCallback(
    (on) => {
      switchLayout(showLiveRef.current, on);
    },
    [switchLayout],
  );

  const handleTimeModeChange = (mode) => {
    setTimeMode(mode);
    try {
      localStorage.setItem(TIME_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  };

  const refresh = useCallback(async () => {
    try {
      const data = await invoke("fetch_usage_data");
      setUsageData(data);
    } catch (e) {
      console.error("Usage data fetch error:", e);
      setUsageData({ buckets: [], error: String(e) });
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Save size on window close via Tauri's async-safe event
  useEffect(() => {
    const unlistenPromise = getCurrentWindow().onCloseRequested(async () => {
      await saveCurrentSize();
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [saveCurrentSize]);

  useEffect(() => {
    if (!showLive) return;

    const el = liveRef.current;
    if (!el) return;

    const baseH = BASE_HEIGHTS[timeMode] ?? 200;
    let rafId = 0;
    let lastScale = -1;

    const updateScale = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (w <= 0 || h <= 0) return;
        const wScale = w / BASE_WIDTH;
        const hScale = h / baseH;
        const scale =
          Math.round(Math.max(0.6, Math.min(wScale, hScale, 2.5)) * 100) / 100;
        if (scale !== lastScale) {
          lastScale = scale;
          el.style.setProperty("--s", scale);
        }
      });
    };

    const observer = new ResizeObserver(updateScale);
    observer.observe(el);
    updateScale();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [timeMode, showLive]);

  const handleContextMenu = (e) => {
    e.preventDefault();
    const menuWidth = 100;
    const menuHeight = 70;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight);
    setMenuPos({ x, y });
    setShowMenu(true);
  };

  const closeMenu = () => setShowMenu(false);

  const handleQuit = async () => {
    closeMenu();
    await saveCurrentSize();
    await getCurrentWindow().close();
  };

  const handleRefresh = () => {
    closeMenu();
    refresh();
  };

  return (
    <div className="app" onContextMenu={handleContextMenu} onClick={closeMenu}>
      <TitleBar
        showLive={showLive}
        showAnalytics={showAnalytics}
        onToggleLive={handleToggleLive}
        onToggleAnalytics={handleToggleAnalytics}
        onClose={handleClose}
      />
      <div className="panels">
        {showLive && (
          <div className="content live-content" ref={liveRef}>
            <UsageDisplay
              data={usageData}
              timeMode={timeMode}
              onTimeModeChange={handleTimeModeChange}
            />
          </div>
        )}
        {showAnalytics && (
          <div className="content analytics-content">
            <AnalyticsView currentBuckets={usageData?.buckets ?? []} />
          </div>
        )}
        {!showLive && !showAnalytics && (
          <div className="content">
            <div className="loading">Toggle a view from the titlebar</div>
          </div>
        )}
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
