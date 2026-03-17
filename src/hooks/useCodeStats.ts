import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RangeType, CodeStats, CodeStatsHistoryPoint } from "../types";

export function useCodeStats(range: RangeType) {
	const [stats, setStats] = useState<CodeStats | null>(null);
	const [history, setHistory] = useState<CodeStatsHistoryPoint[]>([]);
	const [loading, setLoading] = useState(true);
	const initialLoadDone = useRef(false);

	const fetchData = useCallback(async () => {
		if (!initialLoadDone.current) {
			setLoading(true);
		}

		try {
			const [statsData, historyData] = await Promise.all([
				invoke<CodeStats>("get_code_stats", { range }),
				invoke<CodeStatsHistoryPoint[]>("get_code_stats_history", { range }),
			]);
			setStats(statsData);
			setHistory(historyData);
		} catch (e) {
			console.error("Code stats fetch error:", e);
		} finally {
			setLoading(false);
			initialLoadDone.current = true;
		}
	}, [range]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	// Periodic refresh every 60s
	useEffect(() => {
		const interval = setInterval(fetchData, 60_000);
		return () => clearInterval(interval);
	}, [fetchData]);

	return { stats, history, loading, refresh: fetchData };
}
