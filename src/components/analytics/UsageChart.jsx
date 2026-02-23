import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

function dedupeTickLabels(data, formatter) {
  const seen = new Set();
  const allowed = new Set();
  for (let i = 0; i < data.length; i++) {
    const label = formatter(data[i].timestamp);
    if (!seen.has(label)) {
      seen.add(label);
      allowed.add(i);
    }
  }
  return allowed;
}

function formatTime(timestamp, range) {
  const d = new Date(timestamp);
  if (range === "1h") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "24h") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "7d") {
    return d.toLocaleDateString([], { weekday: "short", hour: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getAreaColor(data) {
  if (!data || data.length === 0) return "#34d399";
  const latest = data[data.length - 1].utilization;
  if (latest >= 80) return "#f87171";
  if (latest >= 50) return "#fbbf24";
  return "#34d399";
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;

  const value = payload[0].value;
  const time = new Date(label);
  const color = value >= 80 ? "#f87171" : value >= 50 ? "#fbbf24" : "#34d399";

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-time">
        {time.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>
      <div className="chart-tooltip-value" style={{ color }}>
        {value.toFixed(1)}%
      </div>
    </div>
  );
}

function UsageChart({ data, range, bucket }) {
  if (!data || data.length === 0) {
    return (
      <div className="chart-empty">
        No data for {bucket} in this range
      </div>
    );
  }

  const color = getAreaColor(data);
  const gradientId = `gradient-${bucket.replace(/\s/g, "")}`;

  const formatter = (v) => formatTime(v, range);
  const allowedTicks = dedupeTickLabels(data, formatter);

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart
          data={data}
          margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.15} />
              <stop offset="95%" stopColor={color} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.06)"
            vertical={false}
          />
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatter}
            ticks={data
              .filter((_, i) => allowedTicks.has(i))
              .map((d) => d.timestamp)}
            stroke="rgba(255,255,255,0.2)"
            fontSize={9}
            tickLine={false}
            axisLine={false}
            minTickGap={50}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            stroke="rgba(255,255,255,0.2)"
            fontSize={9}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={80}
            stroke="rgba(248,113,113,0.3)"
            strokeDasharray="4 4"
          />
          <ReferenceLine
            y={50}
            stroke="rgba(251,191,36,0.2)"
            strokeDasharray="4 4"
          />
          <Area
            type="monotone"
            dataKey="utilization"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            animationDuration={300}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default UsageChart;
