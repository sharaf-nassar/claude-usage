use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{Duration, Utc};
use rusqlite::{params, Connection};

use crate::models::{BucketStats, DataPoint, UsageBucket};

fn db_path() -> Result<PathBuf, String> {
    let data_dir = dirs::data_local_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".local").join("share")))
        .ok_or("Cannot determine data directory")?;
    let app_dir = data_dir.join("com.claude.usage-widget");
    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create app data dir: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&app_dir, std::fs::Permissions::from_mode(0o700));
    }

    Ok(app_dir.join("usage.db"))
}

pub struct Storage {
    conn: Mutex<Connection>,
}

impl Storage {
    pub fn init() -> Result<Self, String> {
        let path = db_path()?;
        let conn = Connection::open(&path)
            .map_err(|e| format!("Failed to open database: {e}"))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")
            .map_err(|e| format!("Failed to set pragmas: {e}"))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS usage_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                bucket_label TEXT NOT NULL,
                utilization REAL NOT NULL,
                resets_at TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON usage_snapshots(timestamp);
            CREATE INDEX IF NOT EXISTS idx_snapshots_bucket ON usage_snapshots(bucket_label);
            CREATE INDEX IF NOT EXISTS idx_snapshots_ts_bucket ON usage_snapshots(timestamp, bucket_label);

            CREATE TABLE IF NOT EXISTS usage_hourly (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hour TEXT NOT NULL,
                bucket_label TEXT NOT NULL,
                avg_utilization REAL NOT NULL,
                max_utilization REAL NOT NULL,
                min_utilization REAL NOT NULL,
                sample_count INTEGER NOT NULL,
                UNIQUE(hour, bucket_label)
            );
            CREATE INDEX IF NOT EXISTS idx_hourly_hour ON usage_hourly(hour);
            CREATE INDEX IF NOT EXISTS idx_hourly_bucket ON usage_hourly(bucket_label);",
        )
        .map_err(|e| format!("Failed to create tables: {e}"))?;

        let storage = Self {
            conn: Mutex::new(conn),
        };

        if let Err(e) = storage.aggregate_and_cleanup() {
            eprintln!("Warning: cleanup on startup failed: {e}");
        }

        Ok(storage)
    }

    pub fn store_snapshot(&self, buckets: &[UsageBucket]) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let now = Utc::now().to_rfc3339();

        let tx = conn.transaction().map_err(|e| format!("Transaction error: {e}"))?;
        {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT INTO usage_snapshots (timestamp, bucket_label, utilization, resets_at) VALUES (?1, ?2, ?3, ?4)",
                )
                .map_err(|e| format!("Prepare error: {e}"))?;

            for bucket in buckets {
                stmt.execute(params![now, bucket.label, bucket.utilization, bucket.resets_at])
                    .map_err(|e| format!("Insert error: {e}"))?;
            }
        }
        tx.commit().map_err(|e| format!("Commit error: {e}"))?;

        Ok(())
    }

    pub fn aggregate_and_cleanup(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let cutoff = (Utc::now() - Duration::days(30)).to_rfc3339();

        conn.execute(
            "INSERT OR REPLACE INTO usage_hourly (hour, bucket_label, avg_utilization, max_utilization, min_utilization, sample_count)
             SELECT
                 strftime('%Y-%m-%dT%H:00:00Z', timestamp) as hour,
                 bucket_label,
                 AVG(utilization),
                 MAX(utilization),
                 MIN(utilization),
                 COUNT(*)
             FROM usage_snapshots
             WHERE timestamp < ?1
             GROUP BY hour, bucket_label",
            params![cutoff],
        )
        .map_err(|e| format!("Aggregation insert error: {e}"))?;

        conn.execute(
            "DELETE FROM usage_snapshots WHERE timestamp < ?1",
            params![cutoff],
        )
        .map_err(|e| format!("Aggregation delete error: {e}"))?;

        Ok(())
    }

    pub fn get_usage_history(
        &self,
        bucket: &str,
        range: &str,
    ) -> Result<Vec<DataPoint>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let now = Utc::now();

        let (from, use_hourly) = match range {
            "1h" => (now - Duration::hours(1), false),
            "24h" => (now - Duration::hours(24), false),
            "7d" => (now - Duration::days(7), false),
            "30d" => (now - Duration::days(30), true),
            "all" => (now - Duration::days(365), true),
            _ => (now - Duration::hours(24), false),
        };

        let from_str = from.to_rfc3339();

        if use_hourly {
            let from_hour = from.format("%Y-%m-%dT%H:00:00Z").to_string();
            let mut points = Vec::new();

            // First get hourly aggregates for older data
            let mut stmt = conn
                .prepare_cached(
                    "SELECT hour, avg_utilization FROM usage_hourly
                     WHERE bucket_label = ?1 AND hour >= ?2
                     ORDER BY hour ASC",
                )
                .map_err(|e| format!("Prepare error: {e}"))?;

            let hourly_rows = stmt
                .query_map(params![bucket, from_hour], |row| {
                    Ok(DataPoint {
                        timestamp: row.get(0)?,
                        utilization: row.get(1)?,
                    })
                })
                .map_err(|e| format!("Query error: {e}"))?;

            for row in hourly_rows {
                points.push(row.map_err(|e| format!("Row error: {e}"))?);
            }

            // Then append recent granular snapshots
            let mut stmt2 = conn
                .prepare_cached(
                    "SELECT timestamp, utilization FROM usage_snapshots
                     WHERE bucket_label = ?1 AND timestamp >= ?2
                     ORDER BY timestamp ASC",
                )
                .map_err(|e| format!("Prepare error: {e}"))?;

            let snap_rows = stmt2
                .query_map(params![bucket, from_str], |row| {
                    Ok(DataPoint {
                        timestamp: row.get(0)?,
                        utilization: row.get(1)?,
                    })
                })
                .map_err(|e| format!("Query error: {e}"))?;

            for row in snap_rows {
                points.push(row.map_err(|e| format!("Row error: {e}"))?);
            }

            // Downsample if too many points (max ~720 for charts)
            Ok(downsample(points, 720))
        } else {
            let mut stmt = conn
                .prepare_cached(
                    "SELECT timestamp, utilization FROM usage_snapshots
                     WHERE bucket_label = ?1 AND timestamp >= ?2
                     ORDER BY timestamp ASC",
                )
                .map_err(|e| format!("Prepare error: {e}"))?;

            let rows = stmt
                .query_map(params![bucket, from_str], |row| {
                    Ok(DataPoint {
                        timestamp: row.get(0)?,
                        utilization: row.get(1)?,
                    })
                })
                .map_err(|e| format!("Query error: {e}"))?;

            let mut points = Vec::new();
            for row in rows {
                points.push(row.map_err(|e| format!("Row error: {e}"))?);
            }

            let max_points = match range {
                "1h" => 60,
                "7d" => 672,
                _ => 1440,
            };

            Ok(downsample(points, max_points))
        }
    }

    pub fn get_usage_stats(
        &self,
        bucket: &str,
        days: i32,
    ) -> Result<BucketStats, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        Self::get_usage_stats_with_conn(&conn, bucket, days)
    }

    fn get_usage_stats_with_conn(
        conn: &Connection,
        bucket: &str,
        days: i32,
    ) -> Result<BucketStats, String> {
        let from = (Utc::now() - Duration::days(days as i64)).to_rfc3339();

        let mut stmt = conn
            .prepare_cached(
                "SELECT
                     AVG(utilization),
                     MAX(utilization),
                     MIN(utilization),
                     COUNT(*),
                     (SELECT COUNT(*) FROM usage_snapshots
                      WHERE bucket_label = ?1 AND timestamp >= ?2 AND utilization >= 80.0)
                 FROM usage_snapshots
                 WHERE bucket_label = ?1 AND timestamp >= ?2",
            )
            .map_err(|e| format!("Prepare error: {e}"))?;

        let stats = stmt
            .query_row(params![bucket, from], |row| {
                let total: i64 = row.get(3)?;
                let above_80: i64 = row.get(4)?;
                let pct_above_80 = if total > 0 {
                    (above_80 as f64 / total as f64) * 100.0
                } else {
                    0.0
                };
                Ok(BucketStats {
                    label: bucket.to_string(),
                    current: 0.0, // filled in by caller
                    avg: row.get::<_, Option<f64>>(0)?.unwrap_or(0.0),
                    max: row.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                    min: row.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
                    time_above_80: pct_above_80,
                    trend: String::new(), // filled in below
                    sample_count: total,
                })
            })
            .map_err(|e| format!("Query error: {e}"))?;

        let trend = calc_trend(conn, bucket)?;

        Ok(BucketStats { trend, ..stats })
    }

    pub fn get_all_bucket_stats(
        &self,
        current_buckets: &[UsageBucket],
        days: i32,
    ) -> Result<Vec<BucketStats>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let mut results = Vec::new();
        for bucket in current_buckets {
            let mut stats = Self::get_usage_stats_with_conn(&conn, &bucket.label, days)?;
            stats.current = bucket.utilization;
            results.push(stats);
        }
        Ok(results)
    }

    pub fn get_snapshot_count(&self) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.query_row("SELECT COUNT(*) FROM usage_snapshots", [], |row| row.get(0))
            .map_err(|e| format!("Count error: {e}"))
    }
}

fn calc_trend(conn: &Connection, bucket: &str) -> Result<String, String> {
    let now = Utc::now();
    let one_hour_ago = (now - Duration::hours(1)).to_rfc3339();
    let two_hours_ago = (now - Duration::hours(2)).to_rfc3339();

    let recent_avg: Option<f64> = conn
        .query_row(
            "SELECT AVG(utilization) FROM usage_snapshots
             WHERE bucket_label = ?1 AND timestamp >= ?2",
            params![bucket, one_hour_ago],
            |row| row.get(0),
        )
        .map_err(|e| format!("Trend query error: {e}"))?;

    let prev_avg: Option<f64> = conn
        .query_row(
            "SELECT AVG(utilization) FROM usage_snapshots
             WHERE bucket_label = ?1 AND timestamp >= ?2 AND timestamp < ?3",
            params![bucket, two_hours_ago, one_hour_ago],
            |row| row.get(0),
        )
        .map_err(|e| format!("Trend query error: {e}"))?;

    match (recent_avg, prev_avg) {
        (Some(r), Some(p)) if r > p + 2.0 => Ok("up".into()),
        (Some(r), Some(p)) if r < p - 2.0 => Ok("down".into()),
        (Some(_), Some(_)) => Ok("flat".into()),
        _ => Ok("unknown".into()),
    }
}

fn downsample(points: Vec<DataPoint>, max: usize) -> Vec<DataPoint> {
    if points.len() <= max {
        return points;
    }

    let chunk_size = points.len() / max;
    points
        .chunks(chunk_size)
        .take(max)
        .map(|chunk| {
            let avg_util = chunk.iter().map(|p| p.utilization).sum::<f64>() / chunk.len() as f64;
            DataPoint {
                timestamp: chunk[chunk.len() / 2].timestamp.clone(),
                utilization: avg_util,
            }
        })
        .collect()
}
