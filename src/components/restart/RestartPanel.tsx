import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useToast } from "../../hooks/useToast";
import type {
	ClaudeInstance,
	RestartStatus,
	InstanceStatus,
} from "../../types";

function statusKey(status: InstanceStatus): string {
	if (typeof status === "string") return status.toLowerCase();
	return "failed";
}

function statusText(status: InstanceStatus): string {
	if (typeof status === "string") return status;
	return "Failed";
}

function terminalLabel(inst: ClaudeInstance): string {
	if (inst.terminal_type.type === "Tmux") {
		return `tmux:${inst.terminal_type.target}`;
	}
	const match = inst.tty.match(/pts\/(\d+)$/);
	return match ? `pts/${match[1]}` : inst.tty;
}

function shortenCwd(cwd: string): string {
	return cwd.replace(/^\/home\/[^/]+/, "~");
}

function formatElapsed(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	if (m === 0) return `${s}s`;
	return `${m}m ${s}s`;
}

function RestartPanel() {
	const { toast } = useToast();
	const [status, setStatus] = useState<RestartStatus | null>(null);
	const [hooksInstalled, setHooksInstalled] = useState<boolean | null>(null);
	const [installing, setInstalling] = useState(false);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchStatus = useCallback(async () => {
		const result = await invoke<RestartStatus>("get_restart_status");
		setStatus(result);

		if (result.phase === "Complete") {
			const allOk = result.instances.every(
				(i) => typeof i.status === "string" && i.status !== "Unknown",
			);
			if (allOk) {
				setTimeout(async () => {
					await getCurrentWindow().close();
				}, 3000);
			}
		}
	}, []);

	useEffect(() => {
		fetchStatus();
		invoke<boolean>("check_restart_hooks_installed").then(setHooksInstalled);
		pollRef.current = setInterval(fetchStatus, 1000);
		const unlisten = listen("restart-status-changed", fetchStatus);
		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
			unlisten.then((fn) => fn());
		};
	}, [fetchStatus]);

	const currentPhase = status?.phase;
	useEffect(() => {
		if (currentPhase === "Complete") {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
		}
	}, [currentPhase]);

	const handleRestart = useCallback(async (force: boolean) => {
		await invoke("request_restart", { force });
	}, []);

	const handleCancel = useCallback(async () => {
		await invoke("cancel_restart");
		toast("info", "Restart cancelled.");
		const result = await invoke<RestartStatus>("get_restart_status");
		setStatus(result);
	}, [toast]);

	const handleInstallHooks = useCallback(async () => {
		setInstalling(true);
		try {
			await invoke("install_restart_hooks");
			setHooksInstalled(true);
			toast("info", "Hooks installed.");
		} catch (e) {
			console.error("Failed to install hooks:", e);
		} finally {
			setInstalling(false);
		}
	}, [toast]);

	if (!status) {
		return <div className="restart-panel restart-panel--loading">Loading...</div>;
	}

	const { phase, instances, waiting_on, elapsed_seconds } = status;
	const isWaiting = phase === "WaitingForIdle";
	const isRestarting = phase === "Restarting";
	const isComplete = phase === "Complete";
	const isTimedOut = phase === "TimedOut";
	const canRestart = phase === "Idle" || phase === "Cancelled";
	const instanceCount = instances.length;

	return (
		<div className="restart-panel">
			<div className="restart-list">
				{instanceCount === 0 ? (
					<div className="restart-empty">
						No running Claude Code instances found.
					</div>
				) : (
					instances.map((inst) => (
						<div className="restart-row" key={inst.pid}>
							<div className="restart-row__info">
								<div className="restart-row__cwd" title={inst.cwd}>
									{shortenCwd(inst.cwd)}
								</div>
								<div className="restart-row__terminal">
									{terminalLabel(inst)}
								</div>
							</div>
							<span className={`restart-row__status restart-row__status--${statusKey(inst.status)}`}>
								<span className="restart-row__status-dot" />
								{statusText(inst.status)}
							</span>
						</div>
					))
				)}
			</div>

			<div className="restart-footer">
				<span className={`restart-footer__info${
					isWaiting ? " restart-footer__info--waiting" :
					isComplete ? " restart-footer__info--success" :
					isTimedOut ? " restart-footer__info--warning" : ""
				}`}>
					{isWaiting && `Waiting for ${waiting_on}... ${formatElapsed(elapsed_seconds)}`}
					{isRestarting && "Restarting..."}
					{isComplete && "Restart complete"}
					{isTimedOut && "Timed out"}
					{canRestart && `${instanceCount} instance${instanceCount !== 1 ? "s" : ""}`}
				</span>
				<div className="restart-footer__actions">
					{(isWaiting || isTimedOut) && (
						<button
							className="restart-btn restart-btn--secondary"
							onClick={handleCancel}
						>
							Cancel
						</button>
					)}
					{isTimedOut && (
						<button
							className="restart-btn restart-btn--primary"
							onClick={() => handleRestart(true)}
						>
							Force Restart
						</button>
					)}
					{canRestart && (
						<button
							className="restart-btn restart-btn--primary"
							onClick={() => handleRestart(false)}
							disabled={instanceCount === 0}
						>
							Restart All
						</button>
					)}
				</div>
			</div>

			{hooksInstalled === false && (
				<div className="restart-hook-banner">
					<span>Hooks not installed</span>
					<button
						className="restart-btn restart-btn--primary"
						onClick={handleInstallHooks}
						disabled={installing}
					>
						{installing ? "Installing..." : "Install Hooks"}
					</button>
				</div>
			)}
		</div>
	);
}

export default RestartPanel;
