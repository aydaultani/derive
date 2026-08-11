import { DitherField } from "@/components/spin/dither-field";

/**
 * Onboarding content. Terse and declarative — signage register, not
 * gamer-excited (see CONTRACT.md "Copy"). Each step is small on purpose;
 * this is a walkthrough, not documentation.
 */

export interface OnboardingStep {
  eyebrow: string;
  title: string;
  body: string;
  visual?: React.ReactNode;
}

function RarityVisual() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="chrome w-20 shrink-0 text-[10px] text-platform-dim">COMMON</span>
        <DitherField density={0.12} seed="onboarding-common" cols={16} rows={2} />
      </div>
      <div className="flex items-center gap-3">
        <span className="chrome w-20 shrink-0 text-[10px] text-platform-dim">LEGENDARY</span>
        <DitherField density={0.94} seed="onboarding-legendary" cols={16} rows={2} />
      </div>
    </div>
  );
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    eyebrow: "01 / 07",
    title: "One spin a day.",
    body: "A real NYC place, reachable from where you are by subway, with a dare attached. No rerolls. Go before midnight, or the card expires and your streak dies.",
  },
  {
    eyebrow: "02 / 07",
    title: "Type an address or ZIP.",
    body: "Not a geolocation prompt — an address or ZIP, so this works from anywhere. Origin resolves, snaps to the nearest station, and you're dealt a card.",
  },
  {
    eyebrow: "03 / 07",
    title: "Rarity is derived, not assigned.",
    body: "Travel time, how sparsely a place is tagged, how far it sits from the tourist centroid — that's the score. Common is dense noise, Legendary resolves solid. Every card is tinted by the line that gets you there.",
    visual: <RarityVisual />,
  },
  {
    eyebrow: "04 / 07",
    title: "The dare.",
    body: "Every card carries one instruction that turns the trip into a story instead of an errand. “Order what the person ahead of you ordered.” “Stay until you've read ten pages.”",
  },
  {
    eyebrow: "05 / 07",
    title: "Filters shape the pool, not the results.",
    body: "Max travel time, boroughs, categories, rarity floor, open now, budget, indoors, step-free stations, time of day. Set them once — they persist, and they change what you can be dealt before the roll happens, not after.",
  },
  {
    eyebrow: "06 / 07",
    title: "Prove it.",
    body: "Photo + GPS within 150m of the spot mints the card into your collection. Or mark it honor-system if you'd rather not hand over a photo — shown with a dotted border instead of solid, never hidden.",
  },
  {
    eyebrow: "07 / 07",
    title: "The collection.",
    body: "Every card ever dealt lives in a permanent grid at /collection. Most start greyed out. Completed ones light up, tinted by line. This is the screen people screenshot.",
  },
];
