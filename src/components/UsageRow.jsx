function colorClass(utilization) {
  if (utilization < 50) return "green";
  if (utilization < 80) return "yellow";
  return "red";
}

function gradientColor(utilization) {
  const t = Math.max(0, Math.min(utilization / 100, 1));
  let r, g, b;
  if (t < 0.5) {
    const f = t / 0.5;
    r = Math.round(52 + (251 - 52) * f);
    g = Math.round(211 + (191 - 211) * f);
    b = Math.round(153 + (36 - 153) * f);
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

function UsageRow({ label, utilization, resetsAt }) {
  const fraction = Math.min(utilization / 100, 1);
  const cls = colorClass(utilization);
  const pctColor = gradientColor(utilization);
  const countdown = formatCountdown(resetsAt);

  return (
    <div className="row-box">
      <div className="row-top">
        <span className="row-label">{formatNumUnit(label)}</span>
        <span className="row-percent" style={{ color: pctColor }}>
          {Math.round(utilization)}%
        </span>
        <span className="row-countdown">{countdown}</span>
      </div>
      <div className="progress-track">
        <div
          className={`progress-fill ${cls}`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}

export default UsageRow;
