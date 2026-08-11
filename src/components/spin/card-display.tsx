import type { Card } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { formatExpiryLabel } from "./expiry";
import { MapView } from "./map-view";

export interface CardDisplayProps {
  card: Card;
  /** `lineColor(card.viaLine)` — passed in rather than recomputed here. */
  tint: string;
  /** Proof-flow entry point. See report: `/proof/[cardId]`. */
  proofHref: string;
  /**
   * Destination coordinates aren't on the Card contract (src/lib/schemas.ts
   * only carries originLat/originLon, the spin's starting point — not the
   * dealt place's lat/lon). Left optional; the coordinate line renders
   * only once the API supplies these. See final report for the gap.
   */
  placeLat?: number;
  placeLon?: number;
  /** Also not on Card yet — see report. */
  transfers?: number;
  className?: string;
}

/** Static final-state card layout — the reveal choreography lives in CardReveal. */
export function CardDisplay({
  card,
  tint,
  proofHref,
  placeLat,
  placeLon,
  transfers,
  className,
}: CardDisplayProps) {
  const travelParts = [card.viaLine, `${Math.round(card.travelMinutes)} MIN`];
  if (typeof transfers === "number") {
    travelParts.push(`${transfers} TRANSFER${transfers === 1 ? "" : "S"}`);
  }

  const hasCoords = typeof placeLat === "number" && typeof placeLon === "number";

  return (
    <div className={className}>
      <div className="text-center">
        <h1 className="font-display text-4xl leading-tight text-platform sm:text-5xl">
          {card.name}
        </h1>
        <p className="chrome mt-1 text-xs" style={{ color: tint }}>
          {card.rarityTier}
        </p>
      </div>

      <div className="chrome mt-6 flex flex-col items-center gap-1 text-[11px] text-platform-dim">
        <p>{travelParts.join(" · ")}</p>
        {hasCoords && (
          <p>
            {placeLat.toFixed(4)}, {placeLon.toFixed(4)}
          </p>
        )}
      </div>

      {hasCoords && <MapView lat={placeLat} lon={placeLon} label={card.name} className="mt-4" />}

      <p className="mt-6 text-center text-[15px] leading-relaxed text-platform italic">
        &ldquo;{card.reason}&rdquo;
      </p>

      <div className="mt-6 border-t border-ground-line pt-4 text-center">
        <p className="chrome text-[11px]" style={{ color: tint }}>
          Dare
        </p>
        <p className="mt-2 text-[15px] leading-relaxed text-platform">{card.dare}</p>
      </div>

      <Button href={proofHref} tint={tint} className="mt-7">
        I went &rarr;
      </Button>

      <p className="chrome mt-4 text-center text-[11px] text-platform-dim">
        {formatExpiryLabel(card.dealtDate, card.timezone)}
      </p>
    </div>
  );
}
