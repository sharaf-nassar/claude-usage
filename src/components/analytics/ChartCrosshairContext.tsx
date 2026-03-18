import { createContext, useContext, useRef, useCallback, useEffect } from "react";

type Subscriber = (xPct: number | null) => void;

interface CrosshairValue {
	subscribe: (fn: Subscriber) => () => void;
	setHover: (xPct: number | null) => void;
	getXPercent: () => number | null;
}

export const CrosshairContext = createContext<CrosshairValue>({
	subscribe: () => () => {},
	setHover: () => {},
	getXPercent: () => null,
});

interface CrosshairProviderProps {
	children: React.ReactNode;
}

export function CrosshairProvider({ children }: CrosshairProviderProps) {
	const xPercentRef = useRef<number | null>(null);
	const subscribersRef = useRef(new Set<Subscriber>());

	const subscribe = useCallback((fn: Subscriber) => {
		subscribersRef.current.add(fn);
		return () => {
			subscribersRef.current.delete(fn);
		};
	}, []);

	const setHover = useCallback((pct: number | null) => {
		xPercentRef.current = pct;
		for (const fn of subscribersRef.current) {
			fn(pct);
		}
	}, []);

	const getXPercent = useCallback(() => xPercentRef.current, []);

	return (
		<CrosshairContext.Provider value={{ subscribe, setHover, getXPercent }}>
			{children}
		</CrosshairContext.Provider>
	);
}

/** Hook for MiniChart to subscribe to crosshair updates via direct DOM manipulation */
export function useCrosshairLine(lineRef: React.RefObject<HTMLDivElement | null>) {
	const { subscribe } = useContext(CrosshairContext);

	useEffect(() => {
		return subscribe((xPct) => {
			const el = lineRef.current;
			if (!el) return;
			if (xPct === null) {
				el.style.display = "none";
			} else {
				el.style.display = "";
				el.style.left = `${xPct * 100}%`;
			}
		});
	}, [subscribe, lineRef]);
}

export function useCrosshair() {
	return useContext(CrosshairContext);
}
