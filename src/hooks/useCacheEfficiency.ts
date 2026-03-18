import { useMemo } from "react";
import type { TokenDataPoint } from "../types";

export interface CacheEfficiencyPoint {
	timestamp: string;
	hitRate: number;
}

export function useCacheEfficiency(tokenHistory: TokenDataPoint[]): CacheEfficiencyPoint[] {
	return useMemo(() => {
		return tokenHistory.map((point) => {
			const denominator =
				point.input_tokens +
				point.cache_creation_input_tokens +
				point.cache_read_input_tokens;
			const hitRate = denominator > 0
				? (point.cache_read_input_tokens / denominator) * 100
				: 0;
			return {
				timestamp: point.timestamp,
				hitRate: Math.round(hitRate * 10) / 10,
			};
		});
	}, [tokenHistory]);
}
