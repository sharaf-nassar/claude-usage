import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  ComposedChart,
} from "recharts";
import { formatTokenCount } from "../../utils/tokens";

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

  const time = new Date(label);
  const utilEntry = payload.find((p) => p.dataKey === "utilization");
  const tokenEntry = payload.find((p) => p.dataKey === "total_tokens");

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
      {utilEntry && (
        <div
          className="chart-tooltip-value"
          style={{
            color:
              utilEntry.value >= 80
                ? "#f87171"
                : utilEntry.value >= 50
                  ? "#fbbf24"
                  : "#34d399",
          }}
        >
          {utilEntry.value.toFixed(1)}%
        </div>
      )}
      {tokenEntry && tokenEntry.value > 0 && (
        <div className="chart-tooltip-value" style={{ color: "#60a5fa" }}>
          {formatTokenCount(tokenEntry.value)} tokens
        </div>
      )}
    </div>
  );
}

function UsageChart({ data, range, bucket, tokenData }) {
  if (!data || data.length === 0) {
    return (
      <div className="chart-empty">
        No data for {bucket} in this range
      </div>
    );
  }

  const color = getAreaColor(data);
  const gradientId = `gradient-${bucket.replace(/\s/g, "")}`;
  const hasTokenData = tokenData && tokenData.length > 0;

  // Merge usage and token data by timestamp for the composed chart
  const mergedData = hasTokenData ? mergeDataSeries(data, tokenData) : data;

  const formatter = (v) => formatTime(v, range);
  const allowedTicks = dedupeTickLabels(mergedData, formatter);

  // Compute max token value for right Y-axis
  const maxTokens = hasTokenData
    ? Math.max(...tokenData.map((d) => d.total_tokens), 0)
    : 0;

  if (!hasTokenData) {
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

  // Dual-axis composed chart
  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart
          data={mergedData}
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
            ticks={mergedData
              .filter((_, i) => allowedTicks.has(i))
              .map((d) => d.timestamp)}
            stroke="rgba(255,255,255,0.2)"
            fontSize={9}
            tickLine={false}
            axisLine={false}
            minTickGap={50}
          />
          <YAxis
            yAxisId="left"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            stroke="rgba(255,255,255,0.2)"
            fontSize={9}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, Math.ceil(maxTokens * 1.1)]}
            stroke="rgba(96,165,250,0.3)"
            fontSize={9}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatTokenCount}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            yAxisId="left"
            y={80}
            stroke="rgba(248,113,113,0.3)"
            strokeDasharray="4 4"
          />
          <ReferenceLine
            yAxisId="left"
            y={50}
            stroke="rgba(251,191,36,0.2)"
            strokeDasharray="4 4"
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="utilization"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            animationDuration={300}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="total_tokens"
            stroke="#60a5fa"
            strokeWidth={1.5}
            dot={false}
            animationDuration={300}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function mergeDataSeries(usageData, tokenData) {
  // Build a map of token data by timestamp (rounded to minute)
  const tokenMap = new Map();
  for (const t of tokenData) {
    const key = t.timestamp;
    tokenMap.set(key, t);
  }

  // Start with usage data as the base, attach token fields where timestamps align
  const merged = usageData.map((u) => ({
    ...u,
    total_tokens: null,
  }));

  // Find closest token points for each usage point
  const tokenTimestamps = tokenData.map((t) => new Date(t.timestamp).getTime());

  for (const point of merged) {
    const usageTime = new Date(point.timestamp).getTime();

    // Find the closest token timestamp within a reasonable window
    let closest = null;
    let closestDist = Infinity;
    for (let i = 0; i < tokenTimestamps.length; i++) {
      const dist = Math.abs(tokenTimestamps[i] - usageTime);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    }

    // Match within 30 min window
    if (closest !== null && closestDist < 30 * 60 * 1000) {
      point.total_tokens = tokenData[closest].total_tokens;
    }
  }

  // Also add token data points that don't have nearby usage points
  for (const t of tokenData) {
    const tTime = new Date(t.timestamp).getTime();
    const hasNearby = merged.some(
      (m) => Math.abs(new Date(m.timestamp).getTime() - tTime) < 30 * 60 * 1000,
    );
    if (!hasNearby) {
      merged.push({
        timestamp: t.timestamp,
        utilization: null,
        total_tokens: t.total_tokens,
      });
    }
  }

  // Sort by timestamp
  merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return merged;
}

export default UsageChart;
