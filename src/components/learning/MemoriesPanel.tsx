import { useState, useEffect } from "react";
import { useMemoryData } from "../../hooks/useMemoryData";
import { SuggestionCard } from "./SuggestionCard";

export function MemoriesPanel() {
  const {
    projects,
    selectedProject,
    setSelectedProject,
    memoryFiles,
    suggestions,
    runs,
    optimizing,
    loading,
    logs,
    triggerOptimization,
    triggerOptimizeAll,
    approveSuggestion,
    denySuggestion,
    undenySuggestion,
    undoSuggestion,
    addCustomProject,
    removeCustomProject,
    deleteMemoryFile,
    deleteProjectMemories,
  } = useMemoryData();

  const [showManage, setShowManage] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [showDenied, setShowDenied] = useState(false);
  const [showApproved, setShowApproved] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<
    { type: "file"; path: string; name: string } | { type: "project"; path: string } | null
  >(null);
  const [showEmpty, setShowEmpty] = useState(false);

  // Filter projects: only show those with memories unless toggled
  const visibleProjects = showEmpty
    ? projects
    : projects.filter((p) => p.memory_count > 0 || p.is_custom);

  // If selected project is no longer in the visible list, auto-select first visible
  useEffect(() => {
    if (
      visibleProjects.length > 0 &&
      !visibleProjects.some((p) => p.path === selectedProject)
    ) {
      setSelectedProject(visibleProjects[0].path);
    }
  }, [visibleProjects, selectedProject, setSelectedProject]);

  // Separate memory files from CLAUDE.md files
  const actualMemoryFiles = memoryFiles.filter((f) => f.memory_type !== "claude-md");
  const claudeMdFiles = memoryFiles.filter((f) => f.memory_type === "claude-md");

  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");
  const deniedSuggestions = suggestions.filter((s) => s.status === "denied");
  const approvedSuggestions = suggestions.filter((s) => s.status === "approved");
  const actionableSuggestions = [...pendingSuggestions, ...suggestions.filter((s) => s.status === "undone")];

  const projectsWithMemories = projects.filter((p) => p.memory_count > 0);

  const toggleFile = (fp: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) next.delete(fp);
      else next.add(fp);
      return next;
    });
  };

  const TYPE_COLORS: Record<string, string> = {
    user: "#3B82F6",
    feedback: "#EF4444",
    project: "#22C55E",
    reference: "#EAB308",
    "claude-md": "#A855F7",
  };

  return (
    <div>
      {/* Project selector row */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 6 }}>
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          style={{
            flex: 1,
            background: "#1e1e24",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4,
            color: "#d4d4d4",
            fontSize: 11,
            padding: "3px 6px",
          }}
        >
          {visibleProjects.map((p) => (
            <option key={p.path} value={p.path}>
              {p.name} ({p.memory_count})
            </option>
          ))}
        </select>
        <button
          className="learning-cog-btn"
          onClick={() => setShowManage(!showManage)}
          title="Manage projects"
          style={{ fontSize: 11 }}
        >
          {showManage ? "−" : "+"}
        </button>
        <button
          className="learning-analyze-btn"
          style={{ fontSize: 9, padding: "2px 8px", whiteSpace: "nowrap" }}
          disabled={optimizing || projectsWithMemories.length === 0}
          onClick={triggerOptimizeAll}
        >
          {optimizing ? "..." : "Optimize All"}
        </button>
      </div>

      {/* Manage panel */}
      {showManage && (
        <div
          style={{
            marginTop: 4,
            padding: 6,
            background: "#1e1e24",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
          }}
        >
          {/* Show empty toggle */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
              marginBottom: 6,
            }}
          >
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
              style={{ accentColor: "#22C55E" }}
            />
            Show projects with no memories
          </label>

          {/* Delete all memories for selected project */}
          {selectedProject && actualMemoryFiles.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {confirmDelete?.type === "project" && confirmDelete.path === selectedProject ? (
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    alignItems: "center",
                    fontSize: 10,
                  }}
                >
                  <span style={{ color: "#EF4444" }}>
                    Delete all {actualMemoryFiles.length} memories?
                  </span>
                  <button
                    className="learning-analyze-btn"
                    style={{
                      borderColor: "#EF4444",
                      color: "#EF4444",
                      fontSize: 9,
                      padding: "2px 8px",
                    }}
                    onClick={() => {
                      deleteProjectMemories(selectedProject);
                      setConfirmDelete(null);
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    className="learning-rule-delete"
                    style={{ fontSize: 10, color: "#888" }}
                    onClick={() => setConfirmDelete(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="learning-analyze-btn"
                  style={{
                    borderColor: "rgba(239,68,68,0.4)",
                    color: "#EF4444",
                    fontSize: 9,
                    padding: "2px 8px",
                    width: "100%",
                  }}
                  onClick={() => setConfirmDelete({ type: "project", path: selectedProject })}
                >
                  Delete all memories for this project
                </button>
              )}
            </div>
          )}

          <div
            style={{
              fontSize: 9,
              color: "rgba(255,255,255,0.4)",
              marginBottom: 4,
            }}
          >
            CUSTOM PROJECTS
          </div>
          {projects
            .filter((p) => p.is_custom)
            .map((p) => (
              <div
                key={p.path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 10,
                  padding: "2px 0",
                }}
              >
                <span style={{ flex: 1, color: "#d4d4d4" }}>{p.path}</span>
                <button
                  className="learning-rule-delete"
                  onClick={() => removeCustomProject(p.path)}
                >
                  x
                </button>
              </div>
            ))}
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            <input
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="/path/to/project"
              style={{
                flex: 1,
                background: "#121216",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 3,
                color: "#d4d4d4",
                fontSize: 10,
                padding: "2px 4px",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newPath.trim()) {
                  addCustomProject(newPath.trim());
                  setNewPath("");
                }
              }}
            />
            <button
              className="learning-analyze-btn"
              style={{ fontSize: 9, padding: "2px 6px" }}
              onClick={() => {
                if (newPath.trim()) {
                  addCustomProject(newPath.trim());
                  setNewPath("");
                }
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="learning-empty">Loading...</div>
      ) : (
        <>
          {/* Memory files */}
          <div className="learning-section">
            <div className="learning-section-header">
              MEMORY FILES
              <span className="learning-section-count">
                {actualMemoryFiles.length}
              </span>
            </div>
            {confirmDelete?.type === "file" && (
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  alignItems: "center",
                  fontSize: 10,
                  padding: "4px 8px",
                  marginBottom: 3,
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  borderRadius: 6,
                }}
              >
                <span style={{ color: "#EF4444", flex: 1 }}>
                  Delete {confirmDelete.name}?
                </span>
                <button
                  className="learning-analyze-btn"
                  style={{
                    borderColor: "#EF4444",
                    color: "#EF4444",
                    fontSize: 9,
                    padding: "2px 8px",
                  }}
                  onClick={() => {
                    deleteMemoryFile(confirmDelete.path);
                    setConfirmDelete(null);
                  }}
                >
                  Delete
                </button>
                <button
                  className="learning-rule-delete"
                  style={{ fontSize: 10, color: "#888" }}
                  onClick={() => setConfirmDelete(null)}
                >
                  Cancel
                </button>
              </div>
            )}
            {actualMemoryFiles.length === 0 ? (
              <div className="learning-empty">
                No memory files for this project.
              </div>
            ) : (
              actualMemoryFiles.map((mf) => (
                <div key={mf.file_path} className="learning-rule-card">
                  <div
                    className="learning-rule-header"
                    onClick={() => toggleFile(mf.file_path)}
                  >
                    <span className="learning-rule-expand">
                      {expandedFiles.has(mf.file_path) ? "▾" : "▸"}
                    </span>
                    <span className="learning-rule-name">{mf.file_name}</span>
                    {mf.memory_type && (
                      <span
                        style={{
                          fontSize: 9,
                          padding: "1px 5px",
                          borderRadius: 3,
                          background: `${TYPE_COLORS[mf.memory_type] || "#888"}20`,
                          color: TYPE_COLORS[mf.memory_type] || "#888",
                          textTransform: "uppercase",
                          fontWeight: 600,
                        }}
                      >
                        {mf.memory_type}
                      </span>
                    )}
                    {mf.changed_since_last_run && (
                      <span
                        style={{
                          fontSize: 9,
                          color: "#EAB308",
                          fontWeight: 600,
                        }}
                      >
                        changed
                      </span>
                    )}
                    <button
                      className="learning-rule-delete"
                      title="Delete memory file"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete({ type: "file", path: mf.file_path, name: mf.file_name });
                      }}
                    >
                      x
                    </button>
                  </div>
                  {mf.description && (
                    <span className="learning-rule-domain">
                      {mf.description}
                    </span>
                  )}
                  {expandedFiles.has(mf.file_path) && (
                    <pre className="learning-rule-content">{mf.content}</pre>
                  )}
                </div>
              ))
            )}
          </div>

          {/* CLAUDE.md files */}
          {claudeMdFiles.length > 0 && (
            <div className="learning-section">
              <div className="learning-section-header">
                CLAUDE.MD FILES
                <span className="learning-section-count">
                  {claudeMdFiles.length}
                </span>
              </div>
              {claudeMdFiles.map((mf) => (
                <div key={mf.file_path} className="learning-rule-card">
                  <div
                    className="learning-rule-header"
                    onClick={() => toggleFile(mf.file_path)}
                  >
                    <span className="learning-rule-expand">
                      {expandedFiles.has(mf.file_path) ? "▾" : "▸"}
                    </span>
                    <span className="learning-rule-name">{mf.file_name}</span>
                    <span
                      style={{
                        fontSize: 9,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: `${TYPE_COLORS["claude-md"]}20`,
                        color: TYPE_COLORS["claude-md"],
                        textTransform: "uppercase",
                        fontWeight: 600,
                      }}
                    >
                      CLAUDE.MD
                    </span>
                    {mf.changed_since_last_run && (
                      <span
                        style={{
                          fontSize: 9,
                          color: "#EAB308",
                          fontWeight: 600,
                        }}
                      >
                        changed
                      </span>
                    )}
                  </div>
                  {mf.description && (
                    <span className="learning-rule-domain">
                      {mf.description}
                    </span>
                  )}
                  {expandedFiles.has(mf.file_path) && (
                    <pre className="learning-rule-content">{mf.content}</pre>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Optimize buttons + logs */}
          <div
            style={{
              display: "flex",
              gap: 4,
              alignItems: "center",
              marginTop: 6,
            }}
          >
            <button
              className="learning-analyze-btn"
              disabled={optimizing || !selectedProject}
              onClick={triggerOptimization}
            >
              {optimizing ? "Optimizing..." : "Optimize"}
            </button>
            {runs.length > 0 && (
              <button
                className={`learning-runs-btn${showHistory ? " learning-runs-btn--active" : ""}`}
                onClick={() => setShowHistory(!showHistory)}
              >
                History
                <span className="learning-runs-badge">{runs.length}</span>
              </button>
            )}
          </div>

          {/* Live logs during optimization */}
          {optimizing && logs.length > 0 && (
            <div className="learning-run-detail-logs" style={{ marginTop: 4 }}>
              {logs.join("\n")}
            </div>
          )}

          {/* Suggestions */}
          {actionableSuggestions.length > 0 && (
            <div className="learning-section">
              <div className="learning-section-header">
                SUGGESTIONS
                <span className="learning-section-count">
                  {actionableSuggestions.length}
                </span>
              </div>
              {actionableSuggestions.map((s) => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  onApprove={approveSuggestion}
                  onDeny={denySuggestion}
                  onUndo={undoSuggestion}
                />
              ))}
            </div>
          )}

          {/* Denied suggestions (togglable) */}
          {deniedSuggestions.length > 0 && (
            <div className="learning-section">
              <div
                className="learning-section-header"
                style={{ cursor: "pointer" }}
                onClick={() => setShowDenied(!showDenied)}
              >
                {showDenied ? "▾" : "▸"} DENIED
                <span className="learning-section-count">
                  {deniedSuggestions.length}
                </span>
              </div>
              {showDenied &&
                deniedSuggestions.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    suggestion={s}
                    onApprove={approveSuggestion}
                    onDeny={denySuggestion}
                    onUndeny={undenySuggestion}
                    onUndo={undoSuggestion}
                  />
                ))}
            </div>
          )}

          {/* Approved suggestions (togglable) */}
          {approvedSuggestions.length > 0 && (
            <div className="learning-section">
              <div
                className="learning-section-header"
                style={{ cursor: "pointer" }}
                onClick={() => setShowApproved(!showApproved)}
              >
                {showApproved ? "▾" : "▸"} APPROVED
                <span className="learning-section-count">
                  {approvedSuggestions.length}
                </span>
              </div>
              {showApproved &&
                approvedSuggestions.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    suggestion={s}
                    onApprove={approveSuggestion}
                    onDeny={denySuggestion}
                    onUndeny={undenySuggestion}
                    onUndo={undoSuggestion}
                  />
                ))}
            </div>
          )}

          {/* Run history */}
          {showHistory && (
            <div className="learning-section">
              <div className="learning-section-header">RUN HISTORY</div>
              <div className="learning-runs-list">
                {runs.map((r) => (
                  <div key={r.id} className="learning-run-row">
                    <span
                      className={`learning-run-icon learning-run-icon--${
                        r.status === "completed"
                          ? "ok"
                          : r.status === "failed"
                            ? "fail"
                            : "live-text"
                      }`}
                    >
                      {r.status === "completed"
                        ? "✓"
                        : r.status === "failed"
                          ? "✗"
                          : "●"}
                    </span>
                    <span className="learning-run-trigger">{r.trigger}</span>
                    <span className="learning-run-result">
                      {r.memories_scanned} scanned, {r.suggestions_created}{" "}
                      suggestions
                    </span>
                    <span className="learning-run-time">
                      {new Date(r.started_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
