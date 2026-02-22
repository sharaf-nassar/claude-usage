import UsageRow from "./UsageRow";

function UsageDisplay({ data }) {
  if (!data) {
    return <div className="loading">Loading...</div>;
  }

  if (data.error) {
    return <div className="error-label">{data.error}</div>;
  }

  if (data.buckets.length === 0) {
    return <div className="loading">No usage data</div>;
  }

  return (
    <div className="usage-display">
      <div className="col-header">
        <span />
        <span />
        <span className="col-resets">Resets In</span>
      </div>
      {data.buckets.map((bucket, i) => (
        <UsageRow
          key={i}
          label={bucket.label}
          utilization={bucket.utilization}
          resetsAt={bucket.resets_at}
        />
      ))}
    </div>
  );
}

export default UsageDisplay;
