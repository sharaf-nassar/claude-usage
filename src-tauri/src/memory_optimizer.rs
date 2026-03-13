use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::Emitter;

use crate::ai_client;
use crate::models::{
    ActionType, MemoryFile, MemoryFilesUpdatedEvent, MemoryOptimizerLogEvent,
    MemoryOptimizerUpdatedEvent, OptimizationOutput,
};
use crate::prompt_utils::{safe_truncate, sanitize_for_prompt};
use crate::storage::Storage;

/// Max chars per context section (~4 chars/token)
const MEMORY_BUDGET_CHARS: usize = 600_000;
const CLAUDEMD_BUDGET_CHARS: usize = 240_000;
const RULES_BUDGET_CHARS: usize = 120_000;
const INSTINCTS_BUDGET_CHARS: usize = 80_000;
const MAX_DENIED: usize = 50;

/// Convert a project path to the Claude Code memory directory slug.
fn project_path_to_slug(project_path: &str) -> String {
    project_path.replace('/', "-")
}

/// Recover a filesystem path from a Claude Code project slug.
/// The slug `-home-mamba-work-quill` could be `/home/mamba/work/quill` or
/// `/home/mamba/work-quill` etc. We greedily resolve from the root: at each
/// step, try extending the current segment with `-` first (longer match), and
/// only fall back to `/` (new segment) if the longer match doesn't lead to an
/// existing directory.
fn slug_to_path(slug: &str) -> String {
    let slug = slug.strip_prefix('-').unwrap_or(slug);
    let parts: Vec<&str> = slug.split('-').collect();
    if parts.is_empty() {
        return format!("/{slug}");
    }

    // Greedy resolution: try to build the longest valid path segments
    let mut resolved = String::from("/");
    let mut current_segment = parts[0].to_string();

    for part in &parts[1..] {
        // Try extending current segment with hyphen (e.g., "my-project")
        let extended = format!("{current_segment}-{part}");
        let test_path = format!("{resolved}{extended}");
        if PathBuf::from(&test_path).exists() {
            current_segment = extended;
        } else {
            // Start a new path segment
            resolved.push_str(&current_segment);
            resolved.push('/');
            current_segment = part.to_string();
        }
    }
    resolved.push_str(&current_segment);
    resolved
}

/// Resolve the memory directory for a project.
pub fn memory_dir(project_path: &str) -> PathBuf {
    let slug = project_path_to_slug(project_path);
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home)
        .join(".claude")
        .join("projects")
        .join(slug)
        .join("memory")
}

/// Parse frontmatter from a memory file. Returns (type, description) if found.
fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    if !content.starts_with("---") {
        return (None, None);
    }
    let rest = &content[3..];
    let Some(end_pos) = rest.find("---") else {
        return (None, None);
    };
    let frontmatter = &rest[..end_pos];
    let mut mem_type = None;
    let mut description = None;
    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("type:") {
            mem_type = Some(val.trim().to_string());
        } else if let Some(val) = line.strip_prefix("description:") {
            description = Some(val.trim().to_string());
        }
    }
    (mem_type, description)
}

/// Scan memory files for a project from disk.
pub fn scan_memory_files(storage: &Storage, project_path: &str) -> Result<Vec<MemoryFile>, String> {
    let dir = memory_dir(project_path);

    let prev_hashes = storage.get_memory_file_hashes(project_path)?;
    let mut files = Vec::new();

    if dir.exists() {
        let entries =
            std::fs::read_dir(&dir).map_err(|e| format!("Failed to read memory dir: {e}"))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }

            let file_path_str = path.to_string_lossy().to_string();
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read {}: {e}", file_path_str))?;

            let mut hasher = Sha256::new();
            hasher.update(content.as_bytes());
            let hash = format!("{:x}", hasher.finalize());

            let changed = prev_hashes
                .get(&file_path_str)
                .map(|prev| prev != &hash)
                .unwrap_or(true);

            let (mem_type, description) = parse_frontmatter(&content);

            storage.upsert_memory_file(project_path, &file_path_str, &hash)?;

            files.push(MemoryFile {
                id: 0,
                project_path: project_path.to_string(),
                file_path: file_path_str,
                file_name,
                content_hash: hash,
                last_scanned_at: chrono::Utc::now().to_rfc3339(),
                memory_type: mem_type,
                description,
                content,
                changed_since_last_run: changed,
            });
        }
    }

    // Include CLAUDE.md files as special entries (for frontend display)
    let project_claude_md = PathBuf::from(project_path).join("CLAUDE.md");
    if project_claude_md.exists()
        && let Ok(content) = std::fs::read_to_string(&project_claude_md)
    {
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        let hash = format!("{:x}", hasher.finalize());
        let changed = prev_hashes
            .get(&project_claude_md.to_string_lossy().to_string())
            .map(|prev| prev != &hash)
            .unwrap_or(true);
        files.push(MemoryFile {
            id: 0,
            project_path: project_path.to_string(),
            file_path: project_claude_md.to_string_lossy().to_string(),
            file_name: "CLAUDE.md".to_string(),
            content_hash: hash,
            last_scanned_at: chrono::Utc::now().to_rfc3339(),
            memory_type: Some("claude-md".to_string()),
            description: Some("Project-local CLAUDE.md instructions".to_string()),
            content,
            changed_since_last_run: changed,
        });
    }
    let home_str = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let global_claude_md = PathBuf::from(&home_str).join(".claude").join("CLAUDE.md");
    if global_claude_md.exists()
        && let Ok(content) = std::fs::read_to_string(&global_claude_md)
    {
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        let hash = format!("{:x}", hasher.finalize());
        let changed = prev_hashes
            .get(&global_claude_md.to_string_lossy().to_string())
            .map(|prev| prev != &hash)
            .unwrap_or(true);
        files.push(MemoryFile {
            id: 0,
            project_path: project_path.to_string(),
            file_path: global_claude_md.to_string_lossy().to_string(),
            file_name: "~/.claude/CLAUDE.md".to_string(),
            content_hash: hash,
            last_scanned_at: chrono::Utc::now().to_rfc3339(),
            memory_type: Some("claude-md".to_string()),
            description: Some("Global CLAUDE.md instructions".to_string()),
            content,
            changed_since_last_run: changed,
        });
    }

    Ok(files)
}

fn read_file_optional(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

struct GatheredContext {
    global_claude_md: String,
    project_claude_md: String,
    rules: String,
    instincts: String,
}

fn gather_context(project_path: &str) -> GatheredContext {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let home = PathBuf::from(home);

    let global_claude_md = read_file_optional(&home.join(".claude").join("CLAUDE.md"));
    let project_claude_md = read_file_optional(&PathBuf::from(project_path).join("CLAUDE.md"));

    let mut rules = String::new();
    let rules_dir = home.join(".claude").join("rules");
    if rules_dir.exists() {
        collect_md_files(&rules_dir, &mut rules);
    }

    let mut instincts = String::new();
    let global_instincts_dir = home
        .join(".claude")
        .join("homunculus")
        .join("instincts")
        .join("personal");
    if global_instincts_dir.exists() {
        collect_md_files(&global_instincts_dir, &mut instincts);
    }

    let projects_json_path = home
        .join(".claude")
        .join("homunculus")
        .join("projects.json");
    if projects_json_path.exists()
        && let Ok(json_str) = std::fs::read_to_string(&projects_json_path)
        && let Ok(projects) = serde_json::from_str::<serde_json::Value>(&json_str)
        && let Some(obj) = projects.as_object()
    {
        for (hash_key, info) in obj {
            let matches = info
                .get("path")
                .and_then(|p| p.as_str())
                .map(|p| p == project_path)
                .unwrap_or(false);
            if matches {
                let project_instincts_dir = home
                    .join(".claude")
                    .join("homunculus")
                    .join("projects")
                    .join(hash_key)
                    .join("instincts")
                    .join("personal");
                if project_instincts_dir.exists() {
                    collect_md_files(&project_instincts_dir, &mut instincts);
                }
                break;
            }
        }
    }

    GatheredContext {
        global_claude_md,
        project_claude_md,
        rules,
        instincts,
    }
}

fn collect_md_files(dir: &Path, out: &mut String) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_md_files(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md")
            && let Ok(content) = std::fs::read_to_string(&path)
        {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");
            out.push_str(&format!("\n### {name}\n{content}\n"));
        }
    }
}

fn build_prompt(
    memory_files: &[&MemoryFile],
    context: &GatheredContext,
    denied: &[crate::models::OptimizationSuggestion],
) -> String {
    let mut prompt = String::with_capacity(32_000);

    prompt.push_str(
        "You are a memory and configuration optimization assistant for Claude Code projects.\n\n",
    );
    prompt.push_str("Claude Code uses memory files (project-scoped context) and CLAUDE.md files (instruction sets) to guide the AI assistant. ");
    prompt.push_str(
        "Your job is to analyze both and suggest improvements. All changes require user approval.\n\n",
    );

    // Memories section
    prompt.push_str("## Current Memory Files\n\n");
    if memory_files.is_empty() {
        prompt.push_str("No memory files exist for this project.\n\n");
    } else {
        for mf in memory_files {
            let sanitized = sanitize_for_prompt(&mf.content);
            let content =
                safe_truncate(&sanitized, MEMORY_BUDGET_CHARS / memory_files.len().max(1));
            prompt.push_str(&format!("### File: {}\n{}\n\n", mf.file_name, content));
        }
    }

    // CLAUDE.md section
    let mut claude_md_section = String::new();
    if !context.project_claude_md.is_empty() {
        claude_md_section.push_str("### Project CLAUDE.md (target_file: 'CLAUDE.md')\n");
        claude_md_section.push_str(&sanitize_for_prompt(&context.project_claude_md));
        claude_md_section.push('\n');
    }
    if !context.global_claude_md.is_empty() {
        claude_md_section.push_str("### Global CLAUDE.md (target_file: '~/.claude/CLAUDE.md')\n");
        claude_md_section.push_str(&sanitize_for_prompt(safe_truncate(
            &context.global_claude_md,
            CLAUDEMD_BUDGET_CHARS,
        )));
        claude_md_section.push('\n');
    }
    if !claude_md_section.is_empty() {
        prompt.push_str("## CLAUDE.md Files (optimization targets — can suggest update/flag)\n\n");
        prompt.push_str(&claude_md_section);
        prompt.push('\n');
    }

    if !context.rules.is_empty() {
        prompt.push_str("## Existing Rules\n\n");
        prompt.push_str(safe_truncate(
            &sanitize_for_prompt(&context.rules),
            RULES_BUDGET_CHARS,
        ));
        prompt.push_str("\n\n");
    }

    if !context.instincts.is_empty() {
        prompt.push_str("## Learned Instincts\n\n");
        prompt.push_str(safe_truncate(
            &sanitize_for_prompt(&context.instincts),
            INSTINCTS_BUDGET_CHARS,
        ));
        prompt.push_str("\n\n");
    }

    if !denied.is_empty() {
        prompt.push_str("## Previously Denied Suggestions (DO NOT re-suggest similar actions)\n\n");
        for (i, d) in denied.iter().take(MAX_DENIED).enumerate() {
            prompt.push_str(&format!(
                "{}. {} on '{}': {}\n",
                i + 1,
                d.action_type,
                d.target_file.as_deref().unwrap_or("(new file)"),
                d.reasoning
            ));
        }
        prompt.push('\n');
    }

    prompt.push_str("## Your Task\n\n");
    prompt.push_str(
        "Analyze the memory files and CLAUDE.md files above and suggest optimizations.\n\n",
    );
    prompt.push_str("For memory files, you can suggest: delete, update, merge, create, flag.\n");
    prompt.push_str("For CLAUDE.md files, you can suggest: update, flag (only).\n\n");
    prompt.push_str("For each suggestion, provide:\n");
    prompt.push_str("- action_type: one of 'delete', 'update', 'merge', 'create', 'flag'\n");
    prompt.push_str("- target_file: the filename being acted on (null for create). For CLAUDE.md, use 'CLAUDE.md' for project-local or '~/.claude/CLAUDE.md' for global\n");
    prompt.push_str(
        "- new_filename: filename for create actions (lowercase, hyphens/underscores, no extension)\n",
    );
    prompt.push_str("- reasoning: clear explanation of why this change helps\n");
    prompt.push_str(
        "- proposed_content: full new content for update/create/merge (null for delete/flag)\n",
    );
    prompt.push_str("- merge_sources: list of filenames being merged (for merge only)\n\n");
    prompt.push_str("Focus on:\n");
    prompt
        .push_str("1. Memories that duplicate content already in CLAUDE.md, rules, or instincts\n");
    prompt.push_str("2. Stale memories referencing things that no longer apply\n");
    prompt.push_str("3. Memories that could be more concise\n");
    prompt.push_str("4. Memories that should be merged (overlapping topics)\n");
    prompt.push_str(
        "5. Gaps where a new memory would help (project-specific context not captured elsewhere)\n\n",
    );
    prompt.push_str(
        "If the memories are already clean and optimal, return an empty suggestions array.\n",
    );
    prompt.push_str(
        "Do NOT re-suggest actions similar to previously denied suggestions listed above.\n",
    );

    prompt
}

/// Main entry point: run memory optimization for a project.
/// The run record is created externally (by the Tauri command) so the caller has the run_id.
pub async fn run_optimization_with_run(
    storage: &'static Storage,
    project_path: &str,
    run_id: i64,
    app: &tauri::AppHandle,
) -> Result<i64, String> {
    let _ = app.emit(
        "memory-optimizer-updated",
        MemoryOptimizerUpdatedEvent {
            run_id,
            status: "running".to_string(),
        },
    );

    let emit_log = |msg: &str| {
        log::info!("[memory-optimizer] {msg}");
        let _ = app.emit(
            "memory-optimizer-log",
            MemoryOptimizerLogEvent {
                message: msg.to_string(),
            },
        );
    };

    emit_log("Scanning memory files...");
    let memory_files = match scan_memory_files(storage, project_path) {
        Ok(files) => files,
        Err(e) => {
            storage.update_optimization_run(run_id, 0, 0, "{}", "failed", Some(&e))?;
            let _ = app.emit(
                "memory-optimizer-updated",
                MemoryOptimizerUpdatedEvent {
                    run_id,
                    status: "failed".to_string(),
                },
            );
            return Err(e);
        }
    };

    // Separate memory files from CLAUDE.md entries
    let actual_memory_files: Vec<_> = memory_files
        .iter()
        .filter(|f| f.memory_type.as_deref() != Some("claude-md"))
        .collect();
    let actual_count = actual_memory_files.len();

    emit_log(&format!("Found {} memory files", actual_count));

    if actual_memory_files.is_empty() {
        emit_log("No memory files to optimize — checking if new memories should be suggested");
    }

    emit_log("Gathering context (CLAUDE.md, rules, instincts)...");
    let context = gather_context(project_path);

    let mut sources = serde_json::Map::new();
    sources.insert(
        "project_claude_md".to_string(),
        serde_json::Value::Bool(!context.project_claude_md.is_empty()),
    );
    sources.insert(
        "global_claude_md".to_string(),
        serde_json::Value::Bool(!context.global_claude_md.is_empty()),
    );
    sources.insert(
        "rules".to_string(),
        serde_json::Value::Bool(!context.rules.is_empty()),
    );
    sources.insert(
        "instincts".to_string(),
        serde_json::Value::Bool(!context.instincts.is_empty()),
    );
    let context_sources_json = serde_json::to_string(&sources).unwrap_or_else(|_| "{}".to_string());

    emit_log("Loading denied suggestions...");
    let denied = storage.get_denied_suggestions(project_path, MAX_DENIED as i64)?;

    emit_log("Building analysis prompt...");
    let mem_refs: Vec<&MemoryFile> = actual_memory_files.into_iter().collect();
    let prompt = build_prompt(&mem_refs, &context, &denied);

    emit_log("Calling Anthropic API for analysis...");
    let preamble = "You are a memory optimization assistant. Respond with structured JSON matching the provided schema.";
    let result: OptimizationOutput =
        match ai_client::analyze_typed(&prompt, preamble, ai_client::MODEL_SONNET, 8192).await {
            Ok(r) => r,
            Err(e) => {
                let msg = format!("API analysis failed: {e}");
                emit_log(&msg);
                storage.update_optimization_run(
                    run_id,
                    actual_count as i64,
                    0,
                    &context_sources_json,
                    "failed",
                    Some(&msg),
                )?;
                let _ = app.emit(
                    "memory-optimizer-updated",
                    MemoryOptimizerUpdatedEvent {
                        run_id,
                        status: "failed".to_string(),
                    },
                );
                return Err(msg);
            }
        };

    emit_log(&format!(
        "Received {} suggestions",
        result.suggestions.len()
    ));

    // Store suggestions (with CLAUDE.md action type validation)
    for suggestion in &result.suggestions {
        let targets_claude_md = suggestion
            .target_file
            .as_ref()
            .map(|f| f.ends_with("CLAUDE.md"))
            .unwrap_or(false);
        if targets_claude_md {
            match suggestion.action_type {
                ActionType::Update | ActionType::Flag => {}
                _ => {
                    log::warn!(
                        "Skipping disallowed {} action on CLAUDE.md target: {}",
                        suggestion.action_type,
                        suggestion.target_file.as_deref().unwrap_or("?")
                    );
                    continue;
                }
            }
        }

        let merge_sources_json = suggestion
            .merge_sources
            .as_ref()
            .map(|ms| serde_json::to_string(ms).unwrap_or_else(|_| "[]".to_string()));
        let target_file = match suggestion.action_type {
            ActionType::Create => suggestion.new_filename.as_ref().map(|name| {
                if name.ends_with(".md") {
                    name.clone()
                } else {
                    format!("{name}.md")
                }
            }),
            _ => suggestion.target_file.clone(),
        };
        storage.store_optimization_suggestion(
            run_id,
            project_path,
            &suggestion.action_type.to_string(),
            target_file.as_deref(),
            &suggestion.reasoning,
            suggestion.proposed_content.as_deref(),
            merge_sources_json.as_deref(),
        )?;
    }

    storage.update_optimization_run(
        run_id,
        actual_count as i64,
        result.suggestions.len() as i64,
        &context_sources_json,
        "completed",
        None,
    )?;

    emit_log("Optimization complete");
    let _ = app.emit(
        "memory-optimizer-updated",
        MemoryOptimizerUpdatedEvent {
            run_id,
            status: "completed".to_string(),
        },
    );

    Ok(run_id)
}

/// Execute an approved suggestion — performs the filesystem operation.
pub fn execute_suggestion(
    storage: &Storage,
    suggestion_id: i64,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    let suggestion = storage.get_suggestion_by_id(suggestion_id)?;

    if suggestion.status != "pending" {
        return Err(format!("Suggestion is already {}", suggestion.status));
    }

    let mem_dir = memory_dir(&suggestion.project_path);

    let is_claude_md = suggestion
        .target_file
        .as_ref()
        .map(|f| f.ends_with("CLAUDE.md"))
        .unwrap_or(false);

    // Resolve target path with path traversal protection for non-CLAUDE.md targets
    let resolve_target_path = |target: &str| -> Result<PathBuf, String> {
        if target == "CLAUDE.md" {
            Ok(PathBuf::from(&suggestion.project_path).join("CLAUDE.md"))
        } else if target.contains("/.claude/CLAUDE.md") || target == "~/.claude/CLAUDE.md" {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
            Ok(PathBuf::from(home).join(".claude").join("CLAUDE.md"))
        } else {
            // Path containment check: ensure resolved path stays within mem_dir
            let resolved = mem_dir.join(target);
            let canonical_dir = mem_dir.canonicalize().unwrap_or_else(|_| mem_dir.clone());
            let canonical_resolved = resolved.canonicalize().unwrap_or_else(|_| resolved.clone());
            if !canonical_resolved.starts_with(&canonical_dir) {
                return Err(format!(
                    "Path traversal detected: '{}' resolves outside memory directory",
                    target
                ));
            }
            Ok(resolved)
        }
    };

    match suggestion.action_type.as_str() {
        "delete" => {
            if is_claude_md {
                return Err(
                    "Cannot delete CLAUDE.md files — use update or flag instead".to_string()
                );
            }
            let target = suggestion
                .target_file
                .as_ref()
                .ok_or("Delete suggestion missing target_file")?;
            let path = resolve_target_path(target)?;
            if path.exists() {
                std::fs::remove_file(&path)
                    .map_err(|e| format!("Failed to delete {}: {e}", path.display()))?;
            }
        }
        "update" => {
            let target = suggestion
                .target_file
                .as_ref()
                .ok_or("Update suggestion missing target_file")?;
            let content = suggestion
                .proposed_content
                .as_ref()
                .ok_or("Update suggestion missing proposed_content")?;
            let path = resolve_target_path(target)?;
            std::fs::write(&path, content)
                .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
        }
        "create" => {
            if is_claude_md {
                return Err(
                    "Cannot create CLAUDE.md files — use update or flag instead".to_string()
                );
            }
            let content = suggestion
                .proposed_content
                .as_ref()
                .ok_or("Create suggestion missing proposed_content")?;
            let raw_filename = suggestion
                .target_file
                .as_ref()
                .ok_or("Create suggestion missing target filename")?;
            let filename = if raw_filename.ends_with(".md") {
                raw_filename.clone()
            } else {
                format!("{raw_filename}.md")
            };
            if !crate::prompt_utils::is_safe_memory_name(
                filename.strip_suffix(".md").unwrap_or(&filename),
            ) {
                return Err(format!("Unsafe memory filename: {filename}"));
            }
            let path = mem_dir.join(&filename);
            if !mem_dir.exists() {
                std::fs::create_dir_all(&mem_dir)
                    .map_err(|e| format!("Failed to create memory dir: {e}"))?;
            }
            std::fs::write(&path, content)
                .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
        }
        "merge" => {
            if is_claude_md {
                return Err("Cannot merge CLAUDE.md files — use update or flag instead".to_string());
            }
            let sources: Vec<String> = suggestion.merge_sources.clone().unwrap_or_default();
            let content = suggestion
                .proposed_content
                .as_ref()
                .ok_or("Merge suggestion missing proposed_content")?;
            let target = suggestion
                .target_file
                .as_ref()
                .ok_or("Merge suggestion missing target_file (output name)")?;

            for source in &sources {
                let source_path = resolve_target_path(source)?;
                if !source_path.exists() {
                    return Err(format!("Merge source missing: {source}"));
                }
            }

            let target_path = resolve_target_path(target)?;
            std::fs::write(&target_path, content)
                .map_err(|e| format!("Failed to write merged file: {e}"))?;

            for source in &sources {
                if source != target {
                    let source_path = resolve_target_path(source)?;
                    if source_path.exists() {
                        std::fs::remove_file(&source_path)
                            .map_err(|e| format!("Failed to delete merge source {source}: {e}"))?;
                    }
                }
            }
        }
        "flag" => {
            // No filesystem change — just mark as approved (acknowledged)
        }
        other => {
            return Err(format!("Unknown action type: {other}"));
        }
    }

    storage.update_suggestion_status(suggestion_id, "approved", None)?;

    let _ = app.emit(
        "memory-files-updated",
        MemoryFilesUpdatedEvent {
            project_path: suggestion.project_path.clone(),
        },
    );

    // Generate MEMORY.md follow-up suggestion for non-flag, non-CLAUDE.md actions
    if suggestion.action_type != "flag" && !is_claude_md {
        let memory_md_path = mem_dir.join("MEMORY.md");
        let memory_md_exists = memory_md_path.exists();
        let current_memory_md = if memory_md_exists {
            std::fs::read_to_string(&memory_md_path).unwrap_or_default()
        } else {
            String::new()
        };

        let proposed_update = match suggestion.action_type.as_str() {
            "delete" => {
                if memory_md_exists {
                    let target = suggestion.target_file.as_deref().unwrap_or("");
                    let updated: String = current_memory_md
                        .lines()
                        .filter(|line| !line.contains(target))
                        .collect::<Vec<_>>()
                        .join("\n");
                    if updated != current_memory_md {
                        Some(updated)
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            "create" => {
                let target = suggestion.target_file.as_deref().unwrap_or("new_memory.md");
                let desc = suggestion
                    .proposed_content
                    .as_deref()
                    .and_then(|c| {
                        c.strip_prefix("---").and_then(|rest| {
                            rest.find("---").and_then(|end| {
                                rest[..end]
                                    .lines()
                                    .find(|l| l.trim().starts_with("description:"))
                                    .map(|l| {
                                        l.trim()
                                            .strip_prefix("description:")
                                            .unwrap_or("")
                                            .trim()
                                            .to_string()
                                    })
                            })
                        })
                    })
                    .unwrap_or_else(|| "New memory".to_string());
                let new_line = format!("- [{}]({}) — {}", target, target, desc);
                if memory_md_exists {
                    Some(format!("{}\n{}", current_memory_md.trim_end(), new_line))
                } else {
                    Some(format!("# Memory Index\n\n{}", new_line))
                }
            }
            "merge" => {
                let sources = suggestion.merge_sources.clone().unwrap_or_default();
                let target = suggestion.target_file.as_deref().unwrap_or("");
                if memory_md_exists {
                    let mut updated: String = current_memory_md
                        .lines()
                        .filter(|line| !sources.iter().any(|s| line.contains(s.as_str())))
                        .collect::<Vec<_>>()
                        .join("\n");
                    updated.push_str(&format!("\n- [{}]({}) — Merged memory", target, target));
                    Some(updated)
                } else {
                    None
                }
            }
            "update" => None,
            _ => None,
        };

        if let Some(proposed) = proposed_update {
            let target_name = "MEMORY.md";
            let reasoning = format!(
                "Auto-generated follow-up: update MEMORY.md index after {} action on '{}'",
                suggestion.action_type,
                suggestion.target_file.as_deref().unwrap_or("(new file)")
            );
            let _ = storage.store_optimization_suggestion(
                suggestion.run_id,
                &suggestion.project_path,
                "update",
                Some(target_name),
                &reasoning,
                Some(&proposed),
                None,
            );
        }
    }

    Ok(())
}

/// Get list of known projects (from analytics + custom).
pub fn get_known_projects(storage: &Storage) -> Result<Vec<crate::models::KnownProject>, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let projects_dir = PathBuf::from(&home).join(".claude").join("projects");

    let mut projects: Vec<crate::models::KnownProject> = Vec::new();
    let mut seen_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

    if projects_dir.exists()
        && let Ok(entries) = std::fs::read_dir(&projects_dir)
    {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let dir_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            let display_name = crate::sessions::SessionIndex::project_display_name(&dir_name);
            let memory_path = path.join("memory");
            let has_memories = memory_path.exists();
            let memory_count = if has_memories {
                std::fs::read_dir(&memory_path)
                    .map(|rd| {
                        rd.filter(|e| {
                            e.as_ref()
                                .ok()
                                .and_then(|e| e.path().extension().map(|ext| ext == "md"))
                                .unwrap_or(false)
                        })
                        .count() as i64
                    })
                    .unwrap_or(0)
            } else {
                0
            };

            let resolved_path = slug_to_path(&dir_name);

            if seen_paths.insert(resolved_path.clone()) {
                projects.push(crate::models::KnownProject {
                    path: resolved_path,
                    name: display_name,
                    has_memories,
                    memory_count,
                    is_custom: false,
                });
            }
        }
    }

    if let Ok(Some(custom_json)) = storage.get_setting("memory_optimizer.custom_projects")
        && let Ok(custom_paths) = serde_json::from_str::<Vec<String>>(&custom_json)
    {
        for custom_path in custom_paths {
            if seen_paths.insert(custom_path.clone()) {
                let name = PathBuf::from(&custom_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                let slug = project_path_to_slug(&custom_path);
                let mem_path = PathBuf::from(&home)
                    .join(".claude")
                    .join("projects")
                    .join(&slug)
                    .join("memory");
                let has_memories = mem_path.exists();
                let memory_count = if has_memories {
                    std::fs::read_dir(&mem_path)
                        .map(|rd| {
                            rd.filter(|e| {
                                e.as_ref()
                                    .ok()
                                    .and_then(|e| e.path().extension().map(|ext| ext == "md"))
                                    .unwrap_or(false)
                            })
                            .count() as i64
                        })
                        .unwrap_or(0)
                } else {
                    0
                };
                projects.push(crate::models::KnownProject {
                    path: custom_path,
                    name,
                    has_memories,
                    memory_count,
                    is_custom: true,
                });
            }
        }
    }

    projects.sort_by(|a, b| {
        b.has_memories
            .cmp(&a.has_memories)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(projects)
}
