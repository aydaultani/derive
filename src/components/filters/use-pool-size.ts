"use client";

import { useEffect, useState } from "react";
import type { Filters } from "@/lib/schemas";

interface PoolSizeState {
  poolSize: number | null;
  warning: string | null;
  loading: boolean;
}

function filtersToSearchParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  params.set("maxTravelMinutes", String(filters.maxTravelMinutes));
  params.set("boroughs", filters.boroughs.join(","));
  params.set("categories", filters.categories.join(","));
  params.set("rarityFloor", filters.rarityFloor);
  params.set("openNow", String(filters.openNow));
  params.set("budget", filters.budget);
  params.set("indoorOnly", String(filters.indoorOnly));
  params.set("stepFreeOnly", String(filters.stepFreeOnly));
  params.set("timeOfDay", filters.timeOfDay);
  return params;
}

/**
 * Live pool-size preview against `/api/places`, debounced so dragging
 * through several chips doesn't fire a request per click. `enabled` lets
 * callers hold off until filters have hydrated from localStorage.
 */
export function usePoolSize(filters: Filters, enabled: boolean): PoolSizeState {
  const [state, setState] = useState<PoolSizeState>({ poolSize: null, warning: null, loading: false });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // Kicking off a debounced network fetch is exactly what this effect is
    // for — the loading flag here is syncing UI state with that external
    // request, not state derivable from props/state during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => ({ ...s, loading: true }));

    const timer = setTimeout(() => {
      const params = filtersToSearchParams(filters);
      fetch(`/api/places?${params.toString()}`)
        .then((res) => res.json())
        .then((data: { poolSize?: number; warning?: string | null }) => {
          if (cancelled) return;
          setState({ poolSize: data.poolSize ?? null, warning: data.warning ?? null, loading: false });
        })
        .catch(() => {
          if (cancelled) return;
          setState({ poolSize: null, warning: null, loading: false });
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, JSON.stringify(filters)]);

  return state;
}
