use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{Duration, Utc};
use rusqlite::{Connection, params};

use crate::models::{
    BucketStats, DataPoint, HostBreakdown, ProjectBreakdown, SessionBreakdown, TokenDataPoint,
    TokenReportPayload, TokenStats, UsageBucket,
};

fn db_path() -> Result<PathBuf, String> {
    let data_dir = dirs::data_local_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".local").join("share")))
        .ok_or("Cannot determine data directory")?;
    let app_dir = data_dir.join("com.claude.usage-widget");
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;

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
        let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {e}"))?;

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
            CREATE INDEX IF NOT EXISTS idx_hourly_bucket ON usage_hourly(bucket_label);

            CREATE TABLE IF NOT EXISTS token_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                hostname TEXT NOT NULL DEFAULT 'local',
                timestamp TEXT NOT NULL,
                input_tokens INTEGER NOT NULL,
                output_tokens INTEGER NOT NULL,
                cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
                cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
                cwd TEXT DEFAULT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_token_snap_ts ON token_snapshots(timestamp);
            CREATE INDEX IF NOT EXISTS idx_token_snap_host ON token_snapshots(hostname);

            CREATE TABLE IF NOT EXISTS token_hourly (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hour TEXT NOT NULL,
                hostname TEXT NOT NULL DEFAULT 'local',
                total_input INTEGER NOT NULL,
                total_output INTEGER NOT NULL,
                total_cache_creation INTEGER NOT NULL DEFAULT 0,
                total_cache_read INTEGER NOT NULL DEFAULT 0,
                turn_count INTEGER NOT NULL,
                UNIQUE(hour, hostname)
            );
            CREATE INDEX IF NOT EXISTS idx_token_hourly_hour ON token_hourly(hour);

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .map_err(|e| format!("Failed to create tables: {e}"))?;

        // Migration: add cwd column to token_snapshots if missing
        let has_cwd: bool = conn
            .prepare("SELECT cwd FROM token_snapshots LIMIT 0")
            .is_ok();
        if !has_cwd {
            conn.execute_batch("ALTER TABLE token_snapshots ADD COLUMN cwd TEXT DEFAULT NULL;")
                .map_err(|e| format!("Migration (add cwd column) error: {e}"))?;
        }

        let storage = Self {
            conn: Mutex::new(conn),
        };

        if let Err(e) = storage.aggregate_and_cleanup() {
            eprintln!("Warning: cleanup on startup failed: {e}");
        }

        if let Err(e) = storage.aggregate_and_cleanup_tokens() {
            eprintln!("Warning: token cleanup on startup failed: {e}");
        }

        Ok(storage)
    }

    pub fn store_snapshot(&self, buckets: &[UsageBucket]) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let now = Utc::now().to_rfc3339();

        let tx = conn
            .transaction()
            .map_err(|e| format!("Transaction error: {e}"))?;
        {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT INTO usage_snapshots (timestamp, bucket_label, utilization, resets_at) VALUES (?1, ?2, ?3, ?4)",
                )
                .map_err(|e| format!("Prepare error: {e}"))?;

            for bucket in buckets {
                stmt.execute(params![
                    now,
                    bucket.label,
                    bucket.utilization,
                    bucket.resets_at
                ])
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

    pub fn get_usage_history(&self, bucket: &str, range: &str) -> Result<Vec<DataPoint>, String> {
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

    pub fn get_usage_stats(&self, bucket: &str, days: i32) -> Result<BucketStats, String> {
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

    pub fn store_token_snapshot(&self, payload: &TokenReportPayload) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO token_snapshots (session_id, hostname, timestamp, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cwd)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                payload.session_id,
                payload.hostname,
                now,
                payload.input_tokens,
                payload.output_tokens,
                payload.cache_creation_input_tokens,
                payload.cache_read_input_tokens,
                payload.cwd
            ],
        )
        .map_err(|e| format!("Insert token snapshot error: {e}"))?;

        Ok(())
    }

    pub fn get_token_history(
        &self,
        range: &str,
        hostname: Option<&str>,
        session_id: Option<&str>,
        cwd: Option<&str>,
    ) -> Result<Vec<TokenDataPoint>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let now = Utc::now();

        // Skip hourly aggregates when filtering by session_id or cwd since
        // token_hourly doesn't store those fields
        let needs_granular = session_id.is_some() || cwd.is_some();
        let (from, use_hourly) = match range {
            "1h" => (now - Duration::hours(1), false),
            "24h" => (now - Duration::hours(24), false),
            "7d" => (now - Duration::days(7), false),
            "30d" => (now - Duration::days(30), !needs_granular),
            "all" => (now - Duration::days(365), !needs_granular),
            _ => (now - Duration::hours(24), false),
        };

        let from_str = from.to_rfc3339();
        let mut points = Vec::new();

        if use_hourly {
            let from_hour = from.format("%Y-%m-%dT%H:00:00Z").to_string();

            let (hourly_sql, hourly_params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) =
                if let Some(host) = hostname {
                    (
                        "SELECT hour, total_input, total_output, total_cache_creation, total_cache_read
                         FROM token_hourly
                         WHERE hour >= ?1 AND hostname = ?2
                         ORDER BY hour ASC".to_string(),
                        vec![Box::new(from_hour.clone()), Box::new(host.to_string())],
                    )
                } else {
                    (
                        "SELECT hour, SUM(total_input), SUM(total_output), SUM(total_cache_creation), SUM(total_cache_read)
                         FROM token_hourly
                         WHERE hour >= ?1
                         GROUP BY hour
                         ORDER BY hour ASC".to_string(),
                        vec![Box::new(from_hour.clone())],
                    )
                };

            let mut stmt = conn
                .prepare_cached(&hourly_sql)
                .map_err(|e| format!("Prepare error: {e}"))?;

            let params_refs: Vec<&dyn rusqlite::types::ToSql> =
                hourly_params.iter().map(|p| p.as_ref()).collect();

            let rows = stmt
                .query_map(params_refs.as_slice(), |row| {
                    let inp: i64 = row.get(1)?;
                    let out: i64 = row.get(2)?;
                    let cc: i64 = row.get(3)?;
                    let cr: i64 = row.get(4)?;
                    Ok(TokenDataPoint {
                        timestamp: row.get(0)?,
                        input_tokens: inp,
                        output_tokens: out,
                        cache_creation_input_tokens: cc,
                        cache_read_input_tokens: cr,
                        total_tokens: inp + out + cc + cr,
                    })
                })
                .map_err(|e| format!("Query error: {e}"))?;

            for row in rows {
                points.push(row.map_err(|e| format!("Row error: {e}"))?);
            }
        }

        // Append granular snapshots
        let (snap_sql, snap_params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(
            sid,
        ) =
            session_id
        {
            (
                    "SELECT timestamp, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
                     FROM token_snapshots
                     WHERE timestamp >= ?1 AND session_id = ?2
                     ORDER BY timestamp ASC".to_string(),
                    vec![Box::new(from_str.clone()), Box::new(sid.to_string())],
                )
        } else if let Some(project) = cwd {
            (
                    "SELECT timestamp, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
                     FROM token_snapshots
                     WHERE timestamp >= ?1 AND cwd = ?2
                     ORDER BY timestamp ASC".to_string(),
                    vec![Box::new(from_str.clone()), Box::new(project.to_string())],
                )
        } else if let Some(host) = hostname {
            (
                    "SELECT timestamp, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
                     FROM token_snapshots
                     WHERE timestamp >= ?1 AND hostname = ?2
                     ORDER BY timestamp ASC".to_string(),
                    vec![Box::new(from_str.clone()), Box::new(host.to_string())],
                )
        } else {
            (
                    "SELECT timestamp, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
                     FROM token_snapshots
                     WHERE timestamp >= ?1
                     ORDER BY timestamp ASC".to_string(),
                    vec![Box::new(from_str.clone())],
                )
        };

        let mut stmt2 = conn
            .prepare_cached(&snap_sql)
            .map_err(|e| format!("Prepare error: {e}"))?;

        let params_refs2: Vec<&dyn rusqlite::types::ToSql> =
            snap_params.iter().map(|p| p.as_ref()).collect();

        let snap_rows = stmt2
            .query_map(params_refs2.as_slice(), |row| {
                let inp: i64 = row.get(1)?;
                let out: i64 = row.get(2)?;
                let cc: i64 = row.get(3)?;
                let cr: i64 = row.get(4)?;
                Ok(TokenDataPoint {
                    timestamp: row.get(0)?,
                    input_tokens: inp,
                    output_tokens: out,
                    cache_creation_input_tokens: cc,
                    cache_read_input_tokens: cr,
                    total_tokens: inp + out + cc + cr,
                })
            })
            .map_err(|e| format!("Query error: {e}"))?;

        for row in snap_rows {
            points.push(row.map_err(|e| format!("Row error: {e}"))?);
        }

        let max_points = match range {
            "1h" => 60,
            "7d" => 672,
            "30d" | "all" => 720,
            _ => 1440,
        };

        Ok(downsample_tokens(points, max_points))
    }

    pub fn get_token_stats(
        &self,
        days: i32,
        hostname: Option<&str>,
        cwd: Option<&str>,
    ) -> Result<TokenStats, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let from = (Utc::now() - Duration::days(days as i64)).to_rfc3339();

        let (sql, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) =
            if let Some(project) = cwd {
                (
                    "SELECT
                         COALESCE(SUM(input_tokens), 0),
                         COALESCE(SUM(output_tokens), 0),
                         COALESCE(SUM(cache_creation_input_tokens), 0),
                         COALESCE(SUM(cache_read_input_tokens), 0),
                         COUNT(*)
                     FROM token_snapshots
                     WHERE timestamp >= ?1 AND cwd = ?2"
                        .to_string(),
                    vec![Box::new(from), Box::new(project.to_string())],
                )
            } else if let Some(host) = hostname {
                (
                    "SELECT
                         COALESCE(SUM(input_tokens), 0),
                         COALESCE(SUM(output_tokens), 0),
                         COALESCE(SUM(cache_creation_input_tokens), 0),
                         COALESCE(SUM(cache_read_input_tokens), 0),
                         COUNT(*)
                     FROM token_snapshots
                     WHERE timestamp >= ?1 AND hostname = ?2"
                        .to_string(),
                    vec![Box::new(from), Box::new(host.to_string())],
                )
            } else {
                (
                    "SELECT
                         COALESCE(SUM(input_tokens), 0),
                         COALESCE(SUM(output_tokens), 0),
                         COALESCE(SUM(cache_creation_input_tokens), 0),
                         COALESCE(SUM(cache_read_input_tokens), 0),
                         COUNT(*)
                     FROM token_snapshots
                     WHERE timestamp >= ?1"
                        .to_string(),
                    vec![Box::new(from)],
                )
            };

        let mut stmt = conn
            .prepare_cached(&sql)
            .map_err(|e| format!("Prepare error: {e}"))?;

        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        stmt.query_row(params_refs.as_slice(), |row| {
            let total_input: i64 = row.get(0)?;
            let total_output: i64 = row.get(1)?;
            let total_cache_creation: i64 = row.get(2)?;
            let total_cache_read: i64 = row.get(3)?;
            let turn_count: i64 = row.get(4)?;
            let total_tokens = total_input + total_output + total_cache_creation + total_cache_read;

            Ok(TokenStats {
                total_input,
                total_output,
                total_cache_creation,
                total_cache_read,
                total_tokens,
                turn_count,
                avg_input_per_turn: if turn_count > 0 {
                    total_input as f64 / turn_count as f64
                } else {
                    0.0
                },
                avg_output_per_turn: if turn_count > 0 {
                    total_output as f64 / turn_count as f64
                } else {
                    0.0
                },
            })
        })
        .map_err(|e| format!("Query error: {e}"))
    }

    pub fn get_token_hostnames(&self) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let mut stmt = conn
            .prepare_cached("SELECT DISTINCT hostname FROM token_snapshots ORDER BY hostname ASC")
            .map_err(|e| format!("Prepare error: {e}"))?;

        let rows = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| format!("Query error: {e}"))?;

        let mut hostnames = Vec::new();
        for row in rows {
            hostnames.push(row.map_err(|e| format!("Row error: {e}"))?);
        }
        Ok(hostnames)
    }

    pub fn get_host_breakdown(&self, days: i32) -> Result<Vec<HostBreakdown>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let from = (Utc::now() - Duration::days(days as i64)).to_rfc3339();

        let mut stmt = conn
            .prepare_cached(
                "SELECT
                     hostname,
                     SUM(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens) as total_tokens,
                     COUNT(*) as turn_count,
                     MAX(timestamp) as last_active
                 FROM token_snapshots
                 WHERE timestamp >= ?1
                 GROUP BY hostname
                 ORDER BY total_tokens DESC
                 LIMIT 50",
            )
            .map_err(|e| format!("Prepare error: {e}"))?;

        let rows = stmt
            .query_map(params![from], |row| {
                Ok(HostBreakdown {
                    hostname: row.get(0)?,
                    total_tokens: row.get(1)?,
                    turn_count: row.get(2)?,
                    last_active: row.get(3)?,
                })
            })
            .map_err(|e| format!("Query error: {e}"))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Row error: {e}"))?);
        }
        Ok(results)
    }

    pub fn get_project_breakdown(&self, days: i32) -> Result<Vec<ProjectBreakdown>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let from = (Utc::now() - Duration::days(days as i64)).to_rfc3339();

        let mut stmt = conn
            .prepare_cached(
                "SELECT
                     cwd,
                     hostname,
                     SUM(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens) as total_tokens,
                     COUNT(*) as turn_count,
                     COUNT(DISTINCT session_id) as session_count,
                     MAX(timestamp) as last_active
                 FROM token_snapshots
                 WHERE timestamp >= ?1 AND cwd IS NOT NULL
                 GROUP BY cwd, hostname
                 ORDER BY total_tokens DESC
                 LIMIT 50",
            )
            .map_err(|e| format!("Prepare error: {e}"))?;

        let rows = stmt
            .query_map(params![from], |row| {
                Ok(ProjectBreakdown {
                    project: row.get(0)?,
                    hostname: row.get(1)?,
                    total_tokens: row.get(2)?,
                    turn_count: row.get(3)?,
                    session_count: row.get(4)?,
                    last_active: row.get(5)?,
                })
            })
            .map_err(|e| format!("Query error: {e}"))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Row error: {e}"))?);
        }
        Ok(results)
    }

    pub fn get_session_breakdown(
        &self,
        days: i32,
        hostname: Option<&str>,
    ) -> Result<Vec<SessionBreakdown>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let from = (Utc::now() - Duration::days(days as i64)).to_rfc3339();

        let (sql, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(host) =
            hostname
        {
            (
                    "SELECT
                         s.session_id,
                         s.hostname,
                         SUM(s.input_tokens + s.output_tokens + s.cache_creation_input_tokens + s.cache_read_input_tokens) as total_tokens,
                         COUNT(*) as turn_count,
                         MIN(s.timestamp) as first_seen,
                         MAX(s.timestamp) as last_active,
                         (SELECT t.cwd FROM token_snapshots t
                          WHERE t.session_id = s.session_id AND t.cwd IS NOT NULL
                          ORDER BY t.timestamp DESC LIMIT 1) as project
                     FROM token_snapshots s
                     WHERE s.timestamp >= ?1 AND s.hostname = ?2
                     GROUP BY s.session_id
                     ORDER BY last_active DESC
                     LIMIT 10".to_string(),
                    vec![Box::new(from), Box::new(host.to_string())],
                )
        } else {
            (
                    "SELECT
                         s.session_id,
                         s.hostname,
                         SUM(s.input_tokens + s.output_tokens + s.cache_creation_input_tokens + s.cache_read_input_tokens) as total_tokens,
                         COUNT(*) as turn_count,
                         MIN(s.timestamp) as first_seen,
                         MAX(s.timestamp) as last_active,
                         (SELECT t.cwd FROM token_snapshots t
                          WHERE t.session_id = s.session_id AND t.cwd IS NOT NULL
                          ORDER BY t.timestamp DESC LIMIT 1) as project
                     FROM token_snapshots s
                     WHERE s.timestamp >= ?1
                     GROUP BY s.session_id
                     ORDER BY last_active DESC
                     LIMIT 10".to_string(),
                    vec![Box::new(from)],
                )
        };

        let mut stmt = conn
            .prepare_cached(&sql)
            .map_err(|e| format!("Prepare error: {e}"))?;

        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();

        let rows = stmt
            .query_map(params_refs.as_slice(), |row| {
                Ok(SessionBreakdown {
                    session_id: row.get(0)?,
                    hostname: row.get(1)?,
                    total_tokens: row.get(2)?,
                    turn_count: row.get(3)?,
                    first_seen: row.get(4)?,
                    last_active: row.get(5)?,
                    project: row.get(6)?,
                })
            })
            .map_err(|e| format!("Query error: {e}"))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Row error: {e}"))?);
        }
        Ok(results)
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let mut stmt = conn
            .prepare_cached("SELECT value FROM settings WHERE key = ?1")
            .map_err(|e| format!("Prepare error: {e}"))?;
        let result = stmt.query_row(params![key], |row| row.get(0)).ok();
        Ok(result)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| format!("Setting write error: {e}"))?;
        Ok(())
    }

    pub fn delete_host_data(&self, hostname: &str) -> Result<u64, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;

        let snap_count = conn
            .execute(
                "DELETE FROM token_snapshots WHERE hostname = ?1",
                params![hostname],
            )
            .map_err(|e| format!("Delete snapshots error: {e}"))?;

        let hourly_count = conn
            .execute(
                "DELETE FROM token_hourly WHERE hostname = ?1",
                params![hostname],
            )
            .map_err(|e| format!("Delete hourly error: {e}"))?;

        Ok((snap_count + hourly_count) as u64)
    }

    pub fn delete_session_data(&self, session_id: &str) -> Result<u64, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;

        let count = conn
            .execute(
                "DELETE FROM token_snapshots WHERE session_id = ?1",
                params![session_id],
            )
            .map_err(|e| format!("Delete error: {e}"))?;

        Ok(count as u64)
    }

    pub fn delete_project_data(&self, cwd: &str) -> Result<u64, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;

        let count = conn
            .execute("DELETE FROM token_snapshots WHERE cwd = ?1", params![cwd])
            .map_err(|e| format!("Delete error: {e}"))?;

        Ok(count as u64)
    }

    pub fn aggregate_and_cleanup_tokens(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;
        let cutoff = (Utc::now() - Duration::days(30)).to_rfc3339();

        conn.execute(
            "INSERT OR REPLACE INTO token_hourly (hour, hostname, total_input, total_output, total_cache_creation, total_cache_read, turn_count)
             SELECT
                 strftime('%Y-%m-%dT%H:00:00Z', timestamp) as hour,
                 hostname,
                 SUM(input_tokens),
                 SUM(output_tokens),
                 SUM(cache_creation_input_tokens),
                 SUM(cache_read_input_tokens),
                 COUNT(*)
             FROM token_snapshots
             WHERE timestamp < ?1
             GROUP BY hour, hostname",
            params![cutoff],
        )
        .map_err(|e| format!("Token aggregation insert error: {e}"))?;

        conn.execute(
            "DELETE FROM token_snapshots WHERE timestamp < ?1",
            params![cutoff],
        )
        .map_err(|e| format!("Token aggregation delete error: {e}"))?;

        Ok(())
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

fn downsample_tokens(points: Vec<TokenDataPoint>, max: usize) -> Vec<TokenDataPoint> {
    if points.len() <= max {
        return points;
    }

    let chunk_size = points.len() / max;
    points
        .chunks(chunk_size)
        .take(max)
        .map(|chunk| {
            let inp: i64 = chunk.iter().map(|p| p.input_tokens).sum();
            let out: i64 = chunk.iter().map(|p| p.output_tokens).sum();
            let cc: i64 = chunk.iter().map(|p| p.cache_creation_input_tokens).sum();
            let cr: i64 = chunk.iter().map(|p| p.cache_read_input_tokens).sum();
            TokenDataPoint {
                timestamp: chunk[chunk.len() / 2].timestamp.clone(),
                input_tokens: inp,
                output_tokens: out,
                cache_creation_input_tokens: cc,
                cache_read_input_tokens: cr,
                total_tokens: inp + out + cc + cr,
            }
        })
        .collect()
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
