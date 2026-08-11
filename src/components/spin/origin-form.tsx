"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { LoadingBracket } from "@/components/ui/loading-bracket";

export interface OriginFormProps {
  onSubmit: (origin: string) => void;
  pending: boolean;
  errorMessage?: string | null;
}

/** Free-text address or ZIP — never a geolocation prompt. */
export function OriginForm({ onSubmit, pending, errorMessage }: OriginFormProps) {
  const [origin, setOrigin] = useState("");
  const trimmed = origin.trim();
  const canSubmit = trimmed.length >= 3 && !pending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm">
      <label htmlFor="origin" className="chrome block text-[11px] text-platform-dim">
        Address or ZIP
      </label>
      <input
        id="origin"
        name="origin"
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="e.g. 30 Lafayette Ave, Brooklyn"
        value={origin}
        onChange={(event) => setOrigin(event.target.value)}
        disabled={pending}
        className="mt-2 w-full border border-ground-line bg-ground px-4 py-3.5 text-[15px] text-platform placeholder:text-platform-faint focus:border-platform-dim focus:outline-none disabled:opacity-50"
      />

      <div className="mt-4">
        {pending ? (
          <div className="flex flex-col items-center gap-3 py-1">
            <LoadingBracket />
          </div>
        ) : (
          <Button type="submit" disabled={!canSubmit}>
            Spin
          </Button>
        )}
      </div>

      {errorMessage && (
        <p role="alert" className="chrome mt-3 text-[11px] text-danger">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
