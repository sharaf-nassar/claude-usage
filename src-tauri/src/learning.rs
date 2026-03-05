use std::time::Instant;

use crate::models::{AnalysisRule, LearningRunPayload};
use crate::storage::Storage;
use tauri::Emitter;

/// Returns true if the rule name is safe for use as a filename.
/// Only allows lowercase ASCII letters, digits, and hyphens.
pub fn is_safe_rule_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !name.starts_with('-')
}

/// Sanitize observation text for safe embedding in an LLM prompt.
/// Strips characters that could be used for prompt injection.
fn sanitize_for_prompt(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '[' | ']' | '{' | '}' | '`' => ' ',
            '\n' | '\r' => ' ',
            _ => c,
        })
        .collect()
}

/// Spawns a background analysis using `claude` CLI with Haiku model.
/// Called on session-end or periodic timer.
pub async fn spawn_analysis(
    storage: &'static Storage,
    trigger: &str,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    let mut logs: Vec<String> = Vec::new();

    macro_rules! run_log {
        ($($arg:tt)*) => {{
            let msg = format!($($arg)*);
            log::info!("{msg}");
            let _ = app.emit("learning-log", &msg);
            logs.push(msg);
        }};
    }

    // 1. Check observation count meets threshold
    let min_obs: i64 = storage
        .get_setting("learning.min_observations")
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(50);

    let min_confidence: f64 = storage
        .get_setting("learning.min_confidence")
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.95);

    run_log!(
        "Starting analysis (trigger={trigger}, min_obs={min_obs}, min_confidence={min_confidence:.2})"
    );

    let unanalyzed = storage
        .get_unanalyzed_observation_count()
        .map_err(|e| format!("Failed to get unanalyzed count: {e}"))?;

    if unanalyzed < min_obs {
        return Err(format!(
            "Only {unanalyzed} unanalyzed observations (need {min_obs}). Keep using tools and try again later."
        ));
    }

    run_log!("Found {unanalyzed} unanalyzed observations (threshold: {min_obs})");

    let start = Instant::now();
    let trigger_mode = trigger.to_string();

    // 2. Read unanalyzed observations (only those since last successful run)
    let observations = storage
        .get_unanalyzed_observations(100)
        .map_err(|e| format!("Failed to get observations: {e}"))?;

    run_log!("Loaded {} observations for analysis", observations.len());

    // 3. Read existing rule file names
    let existing_rules = storage.get_learned_rules().unwrap_or_default();
    let existing_filenames: Vec<String> = existing_rules
        .iter()
        .map(|r| format!("{}.md", r.name))
        .collect();

    // Also list rules from ~/.claude/rules/ (recursive to catch subdirectories)
    let mut all_rule_files = existing_filenames;
    if let Some(home) = dirs::home_dir() {
        let rules_dir = home.join(".claude").join("rules");
        if rules_dir.exists() {
            fn collect_md_files(dir: &std::path::Path, out: &mut Vec<String>) {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_dir() {
                            collect_md_files(&path, out);
                        } else if path.is_file()
                            && path.extension().is_some_and(|e| e == "md")
                            && let Some(name) = path.file_name().and_then(|n| n.to_str())
                        {
                            out.push(name.to_string());
                        }
                    }
                }
            }
            collect_md_files(&rules_dir, &mut all_rule_files);
        }
    }

    run_log!(
        "Found {} existing rule files to check against",
        all_rule_files.len()
    );

    // 4. Build compact observation summary for the prompt
    // Group pre/post pairs by session+tool sequence for better pattern detection
    let mut obs_lines = Vec::new();
    let mut i = 0;
    while i < observations.len() {
        let obs = &observations[i];
        let tool = obs.get("tool_name").and_then(|v| v.as_str()).unwrap_or("?");
        let phase = obs
            .get("hook_phase")
            .and_then(|v| v.as_str())
            .unwrap_or("?");
        let input_preview = obs
            .get("tool_input")
            .and_then(|v| v.as_str())
            .map(|s| {
                let truncated = if s.len() > 100 { &s[..100] } else { s };
                sanitize_for_prompt(truncated)
            })
            .unwrap_or_default();

        // Try to pair pre with its matching post (next entry, same tool + session)
        if phase == "pre" && i + 1 < observations.len() {
            let next = &observations[i + 1];
            let next_phase = next
                .get("hook_phase")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let next_tool = next.get("tool_name").and_then(|v| v.as_str()).unwrap_or("");
            let same_session = obs.get("session_id") == next.get("session_id");
            if next_phase == "post" && next_tool == tool && same_session {
                let output_preview = next
                    .get("tool_output")
                    .and_then(|v| v.as_str())
                    .map(|s| {
                        let truncated = if s.len() > 100 { &s[..100] } else { s };
                        sanitize_for_prompt(truncated)
                    })
                    .unwrap_or_default();
                obs_lines.push(format!("- {tool}: {input_preview} -> {output_preview}"));
                i += 2;
                continue;
            }
        }

        obs_lines.push(format!("- {phase} {tool}: {input_preview}"));
        i += 1;
    }

    run_log!("Built prompt with {} observation lines", obs_lines.len());

    let existing_list = all_rule_files
        .iter()
        .map(|f| format!("- {f}"))
        .collect::<Vec<_>>()
        .join("\n");

    let today = chrono::Utc::now().format("%Y-%m-%d");
    let obs_summary = obs_lines.join("\n");

    let prompt = format!(
        "Analyze these Claude Code tool-use observations and identify 0-3 behavioral patterns \
         that should become persistent rules. Focus on repeated corrections, error sequences, \
         and consistent preferences.\n\
         \n\
         Existing rule filenames (skip anything semantically similar to these):\n\
         {existing_list}\n\
         \n\
         Recent observations (phase, tool, input preview):\n\
         {obs_summary}\n\
         \n\
         Output ONLY a valid JSON array, no other text, no markdown fences.\n\
         Each item must have: name (kebab-case, lowercase letters/digits/hyphens only), \
         domain (category), confidence (0-1), content (markdown rule text).\n\
         The name field MUST match the pattern: lowercase letters, digits, and hyphens only. \
         No slashes, dots, or other characters.\n\
         Use today's date {today} in the Learned field of the content.\n\
         \n\
         IMPORTANT: Do NOT create rules that duplicate or overlap with existing ones listed above. \
         Check both the filename AND the semantic meaning. If a pattern is already covered, skip it.\n\
         \n\
         If no new patterns found, output: []",
    );

    run_log!("Prompt size: {} chars", prompt.len());

    // 5. Spawn claude CLI (blocking, run on thread pool)
    run_log!("Invoking claude CLI (model=claude-haiku-4-5-20251001, max-turns=1)");

    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new("claude")
            .args([
                "--model",
                "claude-haiku-4-5-20251001",
                "--max-turns",
                "1",
                "--print",
            ])
            .arg(&prompt)
            .output()
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
    .map_err(|e| format!("Failed to spawn claude CLI: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    run_log!(
        "CLI finished: exit={:?}, stdout={} bytes, stderr={} bytes",
        output.status.code(),
        stdout.len(),
        stderr.len()
    );

    if !stderr.is_empty() {
        run_log!("stderr:\n{}", &stderr[..stderr.len().min(1000)]);
    }

    if !stdout.is_empty() {
        run_log!("LLM response:\n{}", &stdout[..stdout.len().min(2000)]);
    }

    if !output.status.success() {
        let error_msg = format!(
            "claude CLI exit code: {:?}, stderr: {}",
            output.status.code(),
            &stderr[..stderr.len().min(200)]
        );
        run_log!("FAILED: {error_msg}");
        let duration_ms = start.elapsed().as_millis() as i64;
        let _ = storage.store_learning_run(&LearningRunPayload {
            trigger_mode,
            observations_analyzed: observations.len() as i64,
            rules_created: 0,
            rules_updated: 0,
            duration_ms: Some(duration_ms),
            status: "failed".to_string(),
            error: Some(error_msg.clone()),
            logs: Some(logs.join("\n")),
        });
        return Err(format!("claude CLI failed: {stderr}"));
    }

    // 6. Parse JSON output — try to extract JSON array from the output
    let json_str = extract_json_array(&stdout).unwrap_or(&stdout);
    let rules: Vec<AnalysisRule> = match serde_json::from_str(json_str) {
        Ok(r) => r,
        Err(e) => {
            let error_msg = format!("JSON parse error: {e}");
            run_log!("FAILED: {error_msg}");
            run_log!("Raw output: {}", &stdout[..stdout.len().min(500)]);
            let duration_ms = start.elapsed().as_millis() as i64;
            let _ = storage.store_learning_run(&LearningRunPayload {
                trigger_mode,
                observations_analyzed: observations.len() as i64,
                rules_created: 0,
                rules_updated: 0,
                duration_ms: Some(duration_ms),
                status: "failed".to_string(),
                error: Some(error_msg),
                logs: Some(logs.join("\n")),
            });
            return Err(format!("Failed to parse Haiku output: {e}"));
        }
    };

    run_log!("Parsed {} candidate rules from CLI output", rules.len());

    // 7. Write rule files and insert into DB
    let rules_dir = dirs::home_dir()
        .ok_or("Cannot determine home directory")?
        .join(".claude")
        .join("rules")
        .join("learned");
    std::fs::create_dir_all(&rules_dir).map_err(|e| format!("Failed to create rules dir: {e}"))?;

    let mut rules_created = 0i64;
    let mut rules_updated = 0i64;
    // Collect existing rule names for update tracking
    let existing_rule_names: std::collections::HashSet<String> =
        existing_rules.iter().map(|r| r.name.clone()).collect();

    for rule in &rules {
        // Skip rules below confidence threshold
        if rule.confidence < min_confidence {
            run_log!(
                "Skipped '{}': confidence {:.2} < threshold {:.2}",
                rule.name,
                rule.confidence,
                min_confidence
            );
            continue;
        }

        // Validate rule name to prevent path traversal
        if !is_safe_rule_name(&rule.name) {
            run_log!(
                "Skipped '{}': unsafe rule name",
                &rule.name[..rule.name.len().min(50)]
            );
            continue;
        }

        let file_path = rules_dir.join(format!("{}.md", rule.name));

        // Double-check resolved path stays within rules_dir BEFORE writing
        let canonical_dir = rules_dir
            .canonicalize()
            .map_err(|e| format!("Canonicalize rules dir: {e}"))?;
        // Resolve the parent to check containment without needing the file to exist
        let canonical_parent = file_path
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .unwrap_or_default();
        if !canonical_parent.starts_with(&canonical_dir) {
            run_log!("Skipped '{}': path traversal detected", rule.name);
            continue;
        }

        let is_update = existing_rule_names.contains(&rule.name);

        std::fs::write(&file_path, &rule.content)
            .map_err(|e| format!("Failed to write rule file: {e}"))?;

        let _ = storage.store_learned_rule(&crate::models::LearnedRulePayload {
            name: rule.name.clone(),
            domain: Some(rule.domain.clone()),
            confidence: rule.confidence,
            observation_count: observations.len() as i64,
            file_path: file_path.to_string_lossy().to_string(),
        });
        if is_update {
            rules_updated += 1;
            run_log!(
                "Updated rule '{}' (domain={}, confidence={:.2})",
                rule.name,
                rule.domain,
                rule.confidence
            );
        } else {
            rules_created += 1;
            run_log!(
                "Created rule '{}' (domain={}, confidence={:.2})",
                rule.name,
                rule.domain,
                rule.confidence
            );
        }
    }

    let duration_ms = start.elapsed().as_millis() as i64;
    run_log!("Complete: created {rules_created}, updated {rules_updated} in {duration_ms}ms");

    let _ = storage.store_learning_run(&LearningRunPayload {
        trigger_mode,
        observations_analyzed: observations.len() as i64,
        rules_created,
        rules_updated,
        duration_ms: Some(duration_ms),
        status: "completed".to_string(),
        error: None,
        logs: Some(logs.join("\n")),
    });

    Ok(())
}

/// Try to extract a JSON array from potentially noisy output
fn extract_json_array(s: &str) -> Option<&str> {
    let trimmed = s.trim();

    // If it already starts with [ and ends with ], use as-is
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return Some(trimmed);
    }

    // Try to find the first [ and last ]
    let start = trimmed.find('[')?;
    let end = trimmed.rfind(']')?;
    if start < end {
        Some(&trimmed[start..=end])
    } else {
        None
    }
}
