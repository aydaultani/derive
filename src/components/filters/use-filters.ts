"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_FILTERS, FiltersSchema, type Filters } from "@/lib/schemas";

/** localStorage key for persisted filter state. */
export const FILTERS_STORAGE_KEY = "derive:filters";

function readStoredFilters(): Filters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    // Validated through FiltersSchema on read so corrupt local state (a
    // stale shape from a previous schema version, hand-edited JSON, etc.)
    // never crashes the app — silently fall back to defaults instead.
    const parsed = FiltersSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_FILTERS;
  } catch {
    return DEFAULT_FILTERS;
  }
}

/**
 * Filter state persisted to localStorage, validated on read. `hydrated`
 * flips true after the first client-side read so callers can avoid a
 * server/client mismatch flash (we always render DEFAULT_FILTERS on the
 * first paint, then swap in the stored value).
 */
export function useFilters() {
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_FILTERS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Deliberately deferred to an effect rather than a lazy useState
    // initializer: reading localStorage during the initial render would
    // make the client's first render diverge from the server-rendered
    // markup (SSR always sees `DEFAULT_FILTERS`), causing a hydration
    // mismatch. Syncing from the external store after mount is correct here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFiltersState(readStoredFilters());
    setHydrated(true);
  }, []);

  const setFilters = useCallback((next: Filters | ((prev: Filters) => Filters)) => {
    setFiltersState((prev) => {
      const resolved = typeof next === "function" ? (next as (prev: Filters) => Filters)(prev) : next;
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(resolved));
        } catch {
          // Private browsing / quota exceeded — filters just won't persist this session.
        }
      }
      return resolved;
    });
  }, []);

  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [setFilters]);

  return { filters, setFilters, resetFilters, hydrated };
}
