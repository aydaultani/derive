/**
 * Onboarding tour content. Terse and declarative — signage register, not
 * gamer-excited (see CONTRACT.md "Copy"). Each step targets a real element
 * on the home page via `data-onboarding="<key>"` (see SpotlightTour.tsx),
 * so `target` here must match an attribute actually present in page.tsx /
 * origin-form.tsx. `target: null` renders a centered callout instead of a
 * spotlight — reserved for steps with no single sensible anchor.
 */

export interface TourStep {
  /** Matches a `data-onboarding="<key>"` attribute on the real element, or
   *  null for a centered callout with no spotlight. */
  target: string | null;
  eyebrow: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: "wordmark",
    eyebrow: "01 / 06",
    title: "One spin a day.",
    body: "A real NYC place, reachable from where you are by subway, with a dare attached. No rerolls. Go before midnight, or the card expires.",
  },
  {
    target: "origin-input",
    eyebrow: "02 / 06",
    title: "Address or ZIP.",
    body: "Not a geolocation prompt — type an address or ZIP so this works from anywhere. It resolves, snaps to the nearest station, and deals a card.",
  },
  {
    target: "filters-toggle",
    eyebrow: "03 / 06",
    title: "Filters shape the pool.",
    body: "Max travel time, boroughs, categories, rarity floor, open now, budget — set before you spin, not after. They persist across days.",
  },
  {
    target: "spin-button",
    eyebrow: "04 / 06",
    title: "Spin.",
    body: "One real place plus one dare — “order what the person ahead of you ordered,” that kind of thing. Rarity is derived from travel time and how sparsely the place is tagged, not assigned.",
  },
  {
    target: "streak-dots",
    eyebrow: "05 / 06",
    title: "Your streak.",
    body: "One lit dot per consecutive day completed. Miss midnight and it resets.",
  },
  {
    target: "collection-link",
    eyebrow: "06 / 06",
    title: "The collection.",
    body: "Every card ever dealt lives here, tinted by line. Most start greyed out — proof (a photo, or honor system) lights them up. This is the screen people screenshot.",
  },
];
