"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { LoadingBracket } from "@/components/ui/loading-bracket";
import { BracketFrame } from "@/components/ui/bracket-frame";
import type { GeocodeResult } from "@/lib/geocode";

export interface OriginFormProps {
  onSubmit: (origin: string) => void;
  pending: boolean;
  errorMessage?: string | null;
}

const SUGGEST_MIN_LENGTH = 3;
const SUGGEST_DEBOUNCE_MS = 300;
const LISTBOX_ID = "origin-suggestions";

/** Free-text address or ZIP — never a geolocation prompt. */
export function OriginForm({ onSubmit, pending, errorMessage }: OriginFormProps) {
  const [origin, setOrigin] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const trimmed = origin.trim();
  const canSubmit = trimmed.length >= 3 && !pending;

  // Debounced fetch of suggestions whenever the input changes. Clearing
  // state for the "too short to search" case happens synchronously in
  // handleChange below (not here) — calling setState directly in an effect
  // body triggers unnecessary cascading renders.
  useEffect(() => {
    if (pending || trimmed.length < SUGGEST_MIN_LENGTH) return;

    const timer = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      fetch(`/api/geocode/suggest?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : { suggestions: [] }))
        .then((data: { suggestions?: GeocodeResult[] }) => {
          // Ignore stale responses from a request superseded by a newer one.
          if (requestId !== requestIdRef.current) return;
          const next = data.suggestions ?? [];
          setSuggestions(next);
          setOpen(next.length > 0);
          setHighlightedIndex(-1);
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          setSuggestions([]);
          setOpen(false);
        });
    }, SUGGEST_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmed, pending]);

  // Click-outside-to-close.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function handleChange(value: string) {
    setOrigin(value);
    // If the new value is too short to search, drop any stale suggestions
    // and in-flight request immediately rather than waiting on the debounce.
    if (value.trim().length < SUGGEST_MIN_LENGTH) {
      requestIdRef.current++;
      abortRef.current?.abort();
      setSuggestions([]);
      setOpen(false);
      setHighlightedIndex(-1);
    }
  }

  function selectSuggestion(suggestion: GeocodeResult) {
    setOrigin(suggestion.label);
    setSuggestions([]);
    setOpen(false);
    setHighlightedIndex(-1);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (event.key === "Enter") {
      if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        event.preventDefault();
        selectSuggestion(suggestions[highlightedIndex]);
      }
      // else: no highlighted item — let Enter fall through to normal submit.
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm">
      <BracketFrame className="px-1 py-1">
        <label htmlFor="origin" className="chrome block text-[11px] text-platform-dim">
          Address or ZIP
        </label>
        <div ref={containerRef} className="relative mt-2">
          <input
            id="origin"
            name="origin"
            data-onboarding="origin-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="e.g. 30 Lafayette Ave, Brooklyn"
            value={origin}
            onChange={(event) => handleChange(event.target.value)}
            onFocus={() => {
              if (!pending && suggestions.length > 0) setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            disabled={pending}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && !pending}
            aria-controls={LISTBOX_ID}
            aria-activedescendant={
              open && highlightedIndex >= 0 ? `${LISTBOX_ID}-option-${highlightedIndex}` : undefined
            }
            className="w-full border border-ground-line bg-ground px-4 py-3.5 text-[15px] text-platform placeholder:text-platform-faint focus:border-platform-dim focus:outline-none disabled:opacity-50"
          />

          {open && !pending && suggestions.length > 0 && (
            <ul
              id={LISTBOX_ID}
              role="listbox"
              className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto border border-ground-line bg-ground-raised"
            >
              {suggestions.map((suggestion, index) => (
                <li key={`${suggestion.lat}-${suggestion.lon}-${index}`}>
                  <button
                    type="button"
                    id={`${LISTBOX_ID}-option-${index}`}
                    role="option"
                    aria-selected={index === highlightedIndex}
                    onMouseDown={(event) => {
                      // onMouseDown (not onClick) fires before the input's
                      // onBlur / the click-outside handler, so the value
                      // still registers before the dropdown closes.
                      event.preventDefault();
                      selectSuggestion(suggestion);
                    }}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={`block w-full px-4 py-2.5 text-left text-[13px] text-platform hover:bg-ground-line ${
                      index === highlightedIndex ? "bg-ground-line" : ""
                    }`}
                  >
                    {suggestion.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4">
          {pending ? (
            <div className="flex flex-col items-center gap-3 py-1">
              <LoadingBracket />
            </div>
          ) : (
            <Button type="submit" disabled={!canSubmit} data-onboarding="spin-button">
              Spin
            </Button>
          )}
        </div>
      </BracketFrame>

      {errorMessage && (
        <p role="alert" className="chrome mt-3 text-[11px] text-danger">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
