"use client";

import { useRef, useState } from "react";
import { getOrCreateUserId } from "@/lib/local-user";
import { BracketFrame } from "@/components/ui/bracket-frame";
import { SectionTag } from "@/components/ui/section-tag";

interface ProofCaptureProps {
  cardId: string;
  placeName: string;
}

type SubmitState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "success"; proofType: "photo" | "honor" }
  | { phase: "error"; message: string };

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation isn't available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
    });
  });
}

export function ProofCapture({ cardId, placeName }: ProofCaptureProps) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<SubmitState>({ phase: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function submitPhoto() {
    if (!file) {
      setState({ phase: "error", message: "Pick or take a photo first." });
      return;
    }
    setState({ phase: "submitting" });
    try {
      const [position, photoDataUrl] = await Promise.all([getPosition(), readFileAsDataUrl(file)]);
      const res = await fetch("/api/proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId,
          userId: getOrCreateUserId(),
          proofType: "photo",
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          photoDataUrl,
        }),
      });
      const data: { ok: boolean; message?: string } = await res.json();
      if (!res.ok || !data.ok) {
        setState({ phase: "error", message: data.message ?? "Couldn't verify your location." });
        return;
      }
      setState({ phase: "success", proofType: "photo" });
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Something went wrong submitting your proof.",
      });
    }
  }

  async function submitHonor() {
    setState({ phase: "submitting" });
    try {
      const res = await fetch("/api/proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId,
          userId: getOrCreateUserId(),
          proofType: "honor",
        }),
      });
      const data: { ok: boolean; message?: string } = await res.json();
      if (!res.ok || !data.ok) {
        setState({ phase: "error", message: data.message ?? "Couldn't mark this card complete." });
        return;
      }
      setState({ phase: "success", proofType: "honor" });
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Something went wrong marking this complete.",
      });
    }
  }

  if (state.phase === "success") {
    return (
      <BracketFrame className="flex flex-col items-center gap-3 border border-ground-line bg-ground-raised p-6 text-center">
        <SectionTag>Marked complete</SectionTag>
        <p className="chrome text-[11px] text-platform-dim">
          {state.proofType === "photo" ? "Photo-verified." : "Honor system — no photo."}
        </p>
        <a href="/collection" className="chrome text-[11px] text-platform underline decoration-dotted underline-offset-2">
          View your collection →
        </a>
      </BracketFrame>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BracketFrame className="flex flex-col gap-2 border border-ground-line bg-ground-raised p-4">
        <p className="chrome text-[11px] text-platform-dim">
          Step within {150}m of {placeName} and take a photo. We check your GPS against the location — nothing is
          uploaded until you submit.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="chrome text-[11px] text-platform-dim file:chrome file:mr-3 file:border file:border-ground-line file:bg-ground-raised file:px-3 file:py-1.5 file:text-platform"
        />
        <button
          type="button"
          onClick={submitPhoto}
          disabled={state.phase === "submitting" || !file}
          className="chrome border border-platform bg-ground-line px-4 py-3 text-sm text-platform disabled:opacity-40"
        >
          {state.phase === "submitting" ? "Verifying…" : "I WENT →"}
        </button>
      </BracketFrame>

      {state.phase === "error" ? <p className="chrome text-[11px] text-danger">{state.message}</p> : null}

      <div className="border-t border-ground-line pt-3">
        <button
          type="button"
          onClick={submitHonor}
          disabled={state.phase === "submitting"}
          className="chrome text-[11px] text-platform-dim underline decoration-dotted underline-offset-2 hover:text-platform disabled:opacity-40"
        >
          I went (no photo) — honor system
        </button>
      </div>
    </div>
  );
}
