import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LineChart, Line, YAxis, ResponsiveContainer } from "recharts";
import { formatTokenCount } from "../utils/tokens";

function colorClass(utilization) {
  if (utilization < 50) return "green";
  if (utilization < 80) return "yellow";
  return "red";
}

function statusText(utilization) {
  if (utilization < 50) return "";
  if (utilization < 80) return "High";
  return "Crit";
}

function gradientColor(utilization) {
  const t = Math.max(0, Math.min(utilization / 100, 1));
  let r, g, b;
  if (t < 0.5) {
    const f = t / 0.5;
    r = Math.round(52 + (251 - 52) * f);
    g = Math.round(211 + (191 - 211) * f);
    b = Math.round(36 + (153 - 36) * f);
  } else {
    const f = (t - 0.5) / 0.5;
    r = Math.round(251 + (248 - 251) * f);
    g = Math.round(191 + (113 - 191) * f);
    b = Math.round(36 + (113 - 36) * f);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

function formatCountdown(resetsAt) {
  if (!resetsAt) return null;
  try {
    const resetDate = new Date(resetsAt);
    const now = new Date();
    const totalSeconds = Math.floor((resetDate - now) / 1000);
    if (totalSeconds <= 0) return formatNumUnit("now");

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    let raw;
    if (days > 0) {
      raw = `${days}d ${String(hours).padStart(2, "0")}h`;
    } else if (hours > 0) {
      raw = `${hours}h ${String(minutes).padStart(2, "0")}m`;
    } else {
      raw = `${minutes}m`;
    }
    return formatNumUnit(raw);
  } catch {
    return null;
  }
}

function formatNumUnit(text) {
  return text.split("").map((ch, i) => {
    const isDigit = ch >= "0" && ch <= "9";
    return (
      <span key={i} className={isDigit ? "num" : "unit"}>
        {ch}
      </span>
    );
  });
}

function getTimeFraction(resetsAt, label) {
  if (!resetsAt) return null;
  try {
    const resetDate = new Date(resetsAt);
    const now = new Date();
    const remainingMs = resetDate - now;

    const isFiveHour =
      label.toLowerCase().includes("5") && label.toLowerCase().includes("hour");
    const periodMs = isFiveHour ? 5 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;

    const elapsedMs = periodMs - remainingMs;
    return Math.max(0, Math.min(elapsedMs / periodMs, 1));
  } catch {
    return null;
  }
}

function TokenSparkline() {
  const [sparkData, setSparkData] = useState([]);

  useEffect(() => {
    let cancelled = false;
    invoke("get_token_history", { range: "24h", hostname: null })
      .then((data) => {
        if (!cancelled && data.length > 0) {
          const sampled =
            data.length > 30
              ? data.filter((_, i) => i % Math.ceil(data.length / 30) === 0)
              : data;
          setSparkData(sampled);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (sparkData.length < 2) return null;

  const total = sparkData.reduce((s, d) => s + d.total_tokens, 0);

  return (
    <div className="token-sparkline-row">
      <span className="token-sparkline-label">
        {formatTokenCount(total)} tokens (24h)
      </span>
      <div className="token-sparkline-chart">
        <ResponsiveContainer width="100%" height={16}>
          <LineChart
            data={sparkData}
            margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
          >
            <YAxis domain={["dataMin", "dataMax"]} hide />
            <Line
              type="monotone"
              dataKey="total_tokens"
              stroke="#60a5fa"
              strokeWidth={1}
              dot={false}
              animationDuration={200}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MarkerBar({ fraction, cls, timeFraction }) {
  return (
    <div className="progress-track marker-track">
      <div
        className={`progress-fill ${cls}`}
        style={{ width: `${fraction * 100}%` }}
      />
      {timeFraction !== null && (
        <div
          className="time-marker"
          style={{ left: `${timeFraction * 100}%` }}
        />
      )}
    </div>
  );
}

function DualBar({ fraction, cls, timeFraction }) {
  return (
    <div className="bars">
      <div className="progress-track">
        <div
          className={`progress-fill ${cls}`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      {timeFraction !== null && (
        <div className="dual-row">
          <span className="dual-label">time</span>
          <div className="time-track">
            <div
              className="time-fill"
              style={{ width: `${timeFraction * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function BackgroundBar({ fraction, cls, timeFraction }) {
  return (
    <>
      {timeFraction !== null && (
        <div
          className="bg-time-fill"
          style={{ width: `${timeFraction * 100}%` }}
        />
      )}
      <div className="progress-track">
        <div
          className={`progress-fill ${cls}`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </>
  );
}

function UsageRow({
  label,
  utilization,
  resetsAt,
  timeMode,
  showTokenSparkline,
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(interval);
  }, []);

  const fraction = Math.min(utilization / 100, 1);
  const cls = colorClass(utilization);
  const status = statusText(utilization);
  const pctColor = gradientColor(utilization);
  const countdown = formatCountdown(resetsAt);
  const timeFraction = getTimeFraction(resetsAt, label);
  const isBackground = timeMode === "background";

  return (
    <div className={`row-box${isBackground ? " row-box-bg" : ""}`}>
      <div className="row-top">
        <span className="row-label">{formatNumUnit(label)}</span>
        <span className="row-percent" style={{ color: pctColor }}>
          {Math.round(utilization)}%
          <span className="status-label" style={{ color: pctColor }}>
            {status}
          </span>
        </span>
        <span className="row-countdown">{countdown}</span>
      </div>
      {timeMode === "marker" && (
        <MarkerBar fraction={fraction} cls={cls} timeFraction={timeFraction} />
      )}
      {timeMode === "dual" && (
        <DualBar fraction={fraction} cls={cls} timeFraction={timeFraction} />
      )}
      {timeMode === "background" && (
        <BackgroundBar
          fraction={fraction}
          cls={cls}
          timeFraction={timeFraction}
        />
      )}
      {showTokenSparkline && <TokenSparkline />}
    </div>
  );
}

export default UsageRow;
