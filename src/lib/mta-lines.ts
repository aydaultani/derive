/**
 * Official MTA subway line colors (per MTA branding guidelines).
 * Every card is tinted by the line that gets the rider there — this is
 * the single source of truth for that palette. Never hardcode a hex
 * elsewhere; import LINE_COLORS or use the `lineColorVar()` helper so
 * the design tokens in globals.css and JS logic never drift apart.
 */
export const LINE_COLORS = {
  "1": "#EE352E",
  "2": "#EE352E",
  "3": "#EE352E",
  "4": "#00933C",
  "5": "#00933C",
  "6": "#00933C",
  "6X": "#00933C",
  "7": "#B933AD",
  "7X": "#B933AD",
  A: "#0039A6",
  C: "#0039A6",
  E: "#0039A6",
  B: "#FF6319",
  D: "#FF6319",
  F: "#FF6319",
  M: "#FF6319",
  G: "#6CBE45",
  J: "#996633",
  Z: "#996633",
  L: "#A7A9AC",
  N: "#FCCC0A",
  Q: "#FCCC0A",
  R: "#FCCC0A",
  W: "#FCCC0A",
  S: "#808183",
  SIR: "#0039A6",
} as const;

export type LineId = keyof typeof LINE_COLORS;

export const ALL_LINES = Object.keys(LINE_COLORS) as LineId[];

export function isLineId(value: string): value is LineId {
  return Object.prototype.hasOwnProperty.call(LINE_COLORS, value);
}

/** Falls back to a neutral platform grey for unrecognized/multi-line cases. */
export function lineColor(line: string | null | undefined): string {
  if (line && isLineId(line)) return LINE_COLORS[line];
  return "#A7A9AC";
}
