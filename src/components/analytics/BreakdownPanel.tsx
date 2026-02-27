import { useState, useMemo, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useBreakdownData } from "../../hooks/useBreakdownData";
import { formatTokenCount } from "../../utils/tokens";
import type {
  BreakdownMode,
  BreakdownSelection,
  HostBreakdown,
  ProjectBreakdown,
  SessionBreakdown,
} from "../../types";

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function projectName(path: string | null | undefined): string | null {
  if (!path) return null;
  const segments = path.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

const MODES: BreakdownMode[] = ["hosts", "projects", "sessions"];
const MODE_LABELS: Record<BreakdownMode, string> = {
  hosts: "Hosts",
  projects: "Projects",
  sessions: "Sessions",
};
const PAGE_SIZE = 5;
const CONFIRM_TIMEOUT_MS = 3000;

interface TrashIconProps {
  size?: number;
}

function TrashIcon({ size = 12 }: TrashIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 4h12" />
      <path d="M5 4V2.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5V4" />
      <path d="M3.5 4l.75 9.5a1 1 0 0 0 1 .9h5.5a1 1 0 0 0 1-.9L12.5 4" />
      <path d="M6.5 7v4" />
      <path d="M9.5 7v4" />
    </svg>
  );
}

interface BreakdownPanelProps {
  days: number;
  selection: BreakdownSelection | null;
  onSelect: (selection: BreakdownSelection | null) => void;
}

function BreakdownPanel({ days, selection, onSelect }: BreakdownPanelProps) {
  const [mode, setMode] = useState<BreakdownMode>("hosts");
  const [page, setPage] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data, loading, error, refresh } = useBreakdownData(mode, days);

  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageData = useMemo(
    () => data.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
    [data, currentPage],
  );

  const handleModeChange = (m: BreakdownMode) => {
    setMode(m);
    setPage(0);
    resetConfirm();
  };

  const handleRowClick = (
    type: BreakdownSelection["type"],
    key: string,
    row: { first_seen?: string; last_active: string },
  ) => {
    resetConfirm();
    if (selection?.type === type && selection?.key === key) {
      onSelect(null);
    } else {
      onSelect({
        type,
        key,
        firstSeen: row.first_seen || row.last_active,
        lastActive: row.last_active,
      });
    }
  };

  const isSelected = (type: BreakdownSelection["type"], key: string) =>
    selection?.type === type && selection?.key === key;

  const resetConfirm = useCallback(() => {
    setConfirmDelete(false);
    if (confirmTimer.current) {
      clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
  }, []);

  const handleDeleteClick = useCallback(async () => {
    if (!selection) return;

    if (!confirmDelete) {
      setConfirmDelete(true);
      confirmTimer.current = setTimeout(() => {
        setConfirmDelete(false);
      }, CONFIRM_TIMEOUT_MS);
      return;
    }

    // Confirmed — perform delete
    resetConfirm();
    setDeleting(true);

    const commandMap: Record<BreakdownSelection["type"], string> = {
      host: "delete_host_data",
      project: "delete_project_data",
      session: "delete_session_data",
    };
    const argsMap: Record<
      BreakdownSelection["type"],
      Record<string, string>
    > = {
      host: { hostname: selection.key },
      project: { cwd: selection.key },
      session: { sessionId: selection.key },
    };
    const command = commandMap[selection.type];
    const args = argsMap[selection.type];

    await invoke(command, args);
    onSelect(null);
    refresh();
    setDeleting(false);
  }, [selection, confirmDelete, resetConfirm, onSelect, refresh]);

  return (
    <div className="breakdown-panel">
      <div className="breakdown-header">
        <div className="range-tabs breakdown-toggle">
          {MODES.map((m) => (
            <button
              key={m}
              className={`range-tab${mode === m ? " active" : ""}`}
              onClick={() => handleModeChange(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {selection && (
          <button
            className="breakdown-clear-btn"
            onClick={() => {
              resetConfirm();
              onSelect(null);
            }}
            aria-label="Clear selection"
          >
            &#10005;
          </button>
        )}
        <div className="breakdown-header-right">
          {data.length > PAGE_SIZE && (
            <div className="breakdown-pagination">
              <button
                className="breakdown-page-btn"
                disabled={currentPage === 0}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Previous page"
              >
                &#9664;
              </button>
              <span className="breakdown-page-info">
                {currentPage + 1}/{totalPages}
              </span>
              <button
                className="breakdown-page-btn"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                &#9654;
              </button>
            </div>
          )}
          {selection && (
            <button
              className={`breakdown-delete-btn${confirmDelete ? " confirm" : ""}`}
              onClick={handleDeleteClick}
              disabled={deleting}
              aria-label={
                confirmDelete
                  ? `Confirm delete ${selection.type}: ${selection.key}`
                  : `Delete ${selection.type}: ${selection.key}`
              }
              title={
                confirmDelete
                  ? "Click again to confirm"
                  : `Delete all data for this ${selection.type}`
              }
            >
              {deleting ? (
                <span className="breakdown-delete-spinner" />
              ) : confirmDelete ? (
                "Delete?"
              ) : (
                <TrashIcon size={11} />
              )}
            </button>
          )}
        </div>
      </div>

      {error && <div className="analytics-error">{error}</div>}

      {loading ? (
        <div className="breakdown-empty">Loading...</div>
      ) : data.length === 0 ? (
        <div className="breakdown-empty">No {mode} data yet</div>
      ) : (
        <div
          className="breakdown-list"
          role="list"
          aria-label={`${MODE_LABELS[mode]} breakdown`}
        >
          {mode === "hosts"
            ? (pageData as HostBreakdown[]).map((row) => (
                <div
                  key={row.hostname}
                  className={`breakdown-row${isSelected("host", row.hostname) ? " selected" : ""}`}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${row.hostname}: ${formatTokenCount(row.total_tokens)} tokens, ${row.turn_count} turns`}
                  onClick={() => handleRowClick("host", row.hostname, row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleRowClick("host", row.hostname, row);
                    }
                  }}
                >
                  <span className="breakdown-name" title={row.hostname}>
                    {row.hostname}
                  </span>
                  <span className="breakdown-tokens">
                    {formatTokenCount(row.total_tokens)}
                  </span>
                  <span className="breakdown-turns">
                    {row.turn_count} turns
                  </span>
                  <span className="breakdown-time">
                    {formatRelativeTime(row.last_active)}
                  </span>
                </div>
              ))
            : mode === "projects"
              ? (pageData as ProjectBreakdown[]).map((row) => (
                  <div
                    key={`${row.project}::${row.hostname}`}
                    className={`breakdown-row breakdown-row-project${isSelected("project", row.project) ? " selected" : ""}`}
                    role="listitem"
                    tabIndex={0}
                    aria-label={`${projectName(row.project)} on ${row.hostname}: ${formatTokenCount(row.total_tokens)} tokens, ${row.turn_count} turns, ${row.session_count} sessions`}
                    onClick={() => handleRowClick("project", row.project, row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleRowClick("project", row.project, row);
                      }
                    }}
                  >
                    <span className="breakdown-name" title={row.project}>
                      {projectName(row.project)}
                      <span className="breakdown-host-tag">{row.hostname}</span>
                    </span>
                    <span className="breakdown-tokens">
                      {formatTokenCount(row.total_tokens)}
                    </span>
                    <span className="breakdown-turns">
                      {row.turn_count} turns
                      <span className="breakdown-session-count">
                        {row.session_count} sess
                      </span>
                    </span>
                    <span className="breakdown-time">
                      {formatRelativeTime(row.last_active)}
                    </span>
                  </div>
                ))
              : (pageData as SessionBreakdown[]).map((row) => (
                  <div
                    key={row.session_id}
                    className={`breakdown-row breakdown-row-session${isSelected("session", row.session_id) ? " selected" : ""}`}
                    role="listitem"
                    tabIndex={0}
                    aria-label={`Session ${row.session_id.slice(0, 8)}${projectName(row.project) ? ` in ${projectName(row.project)}` : ""} on ${row.hostname}: ${formatTokenCount(row.total_tokens)} tokens, ${row.turn_count} turns`}
                    onClick={() =>
                      handleRowClick("session", row.session_id, row)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleRowClick("session", row.session_id, row);
                      }
                    }}
                  >
                    <span className="breakdown-name" title={row.session_id}>
                      {row.session_id.slice(0, 8)}
                      {projectName(row.project) && (
                        <span
                          className="breakdown-project-tag"
                          title={row.project ?? undefined}
                        >
                          {projectName(row.project)}
                        </span>
                      )}
                      <span className="breakdown-host-tag">{row.hostname}</span>
                    </span>
                    <span className="breakdown-tokens">
                      {formatTokenCount(row.total_tokens)}
                    </span>
                    <span className="breakdown-turns">
                      {row.turn_count} turns
                    </span>
                    <span className="breakdown-time">
                      {formatRelativeTime(row.last_active)}
                    </span>
                  </div>
                ))}
        </div>
      )}
    </div>
  );
}

export default BreakdownPanel;
