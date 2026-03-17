import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SessionCodeStats } from "../types";

type StatsMap = Record<string, SessionCodeStats>;

export function useSessionCodeStats(sessionIds: string[]) {
	const [statsMap, setStatsMap] = useState<StatsMap>({});
	const cacheRef = useRef<StatsMap>({});

	const fetchMissing = useCallback(async (ids: string[]) => {
		// Filter out IDs already in cache
		const missing = ids.filter((id) => !(id in cacheRef.current));
		if (missing.length === 0) return;

		try {
			const result = await invoke<StatsMap>("get_batch_session_code_stats", {
				sessionIds: missing,
			});
			// Merge into cache (missing IDs not in result have zero changes)
			for (const id of missing) {
				cacheRef.current[id] = result[id] ?? {
					lines_added: 0,
					lines_removed: 0,
					net_change: 0,
				};
			}
			setStatsMap({ ...cacheRef.current });
		} catch (e) {
			console.error("Session code stats fetch error:", e);
		}
	}, []);

	useEffect(() => {
		if (sessionIds.length > 0) {
			fetchMissing(sessionIds);
		}
	}, [sessionIds, fetchMissing]);

	return statsMap;
}
