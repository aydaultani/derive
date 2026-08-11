/**
 * Guard against real-world access codes leaking into card copy.
 *
 * DERIVE's card copy (name/reason/dare) is committed to data/derive.sqlite
 * as seed data and ships in a public repo. A dare that contains, or tells a
 * player to go extract, a real door/bathroom/gate code for a real NYC
 * address is a genuine safety problem and — once pushed — not undoable.
 *
 * Today's committed corpus is 100% hand-authored fallback templates and is
 * clean. The actual exposure is the LLM path (llmCopyFor in
 * generate-cards.ts), whose only validation today is `typeof === "string"`.
 * This module is the content check that closes that gap, plus a corpus test
 * (copy-safety.test.ts) that fails the build if a bad row is ever committed.
 *
 * Two violation classes:
 *  1. A literal digit code near a code word — "the code is 1234", "punch in
 *     4-3-2-1".
 *  2. An instruction to obtain/share a code with no digits present — "ask
 *     for the bathroom code", "get the door code". This is the likelier LLM
 *     failure mode and arguably the bigger harm, since it directs a player
 *     to go extract and (via a photo dare) effectively publish a code.
 *
 * A benign-phrase allowlist is required or this fires constantly on
 * ordinary copy ("dress code", "zip code", "QR code", ...). Allowlisted
 * phrases are stripped from the text before either class is matched.
 */

// Phrases where "code"/"pin" is not an access code — stripped before
// matching so they can never trip either check.
export const BENIGN_CODE_PHRASES = [
  "dress code",
  "zip code",
  "area code",
  "post code",
  "postcode",
  "qr code",
  "bar code",
  "barcode",
  "morse code",
  "source code",
  "code switch",
  "code-switch",
  "promo code",
  "coupon code",
  "color code",
  "colour code",
  "map pin",
  "pin down",
  "pinned",
  "pin it",
  "pin these",
];

// Words that signal "this text is talking about an access code," matched
// against a following digit run (class A) or an acquisition verb (class B).
const CODE_WORDS = ["code", "pin", "passcode", "combination", "keypad"];

// Verbs/nouns of acquisition — "ask ... code", "get ... door", etc.
const ACQUISITION_WORDS = [
  "ask", "get", "find out", "share", "post", "enter", "punch in",
  "door", "entry", "access", "bathroom", "restroom", "gate", "lock",
];

// Word-boundary containment — plain `.includes()` would match "pin" inside
// "Pine" or "code" inside "encode", which is exactly the kind of false
// positive (e.g. "Euclid Pine Block Association") this exists to avoid.
function containsWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

function stripBenignPhrases(text: string): string {
  let cleaned = text.toLowerCase();
  for (const phrase of BENIGN_CODE_PHRASES) {
    cleaned = cleaned.split(phrase).join(" ");
  }
  return cleaned;
}

// A 3-6 digit run, optionally separated by "-", "*", or spaces (e.g.
// "1234", "4-3-2-1", "12 34"), within ~30 characters of a code word.
function findLiteralCodeViolations(cleaned: string): string[] {
  const violations: string[] = [];
  const digitRun = /\b(?:\d[\s*-]?){3,6}\b/g;
  let match: RegExpExecArray | null;
  while ((match = digitRun.exec(cleaned)) !== null) {
    const windowStart = Math.max(0, match.index - 30);
    const windowEnd = Math.min(cleaned.length, match.index + match[0].length + 30);
    const window = cleaned.slice(windowStart, windowEnd);
    if (CODE_WORDS.some((w) => containsWord(window, w))) {
      violations.push(match[0].trim());
    }
  }
  return violations;
}

// A code word within ~20 characters of an acquisition word, in either
// order ("ask for the door code" / "code to the door — ask inside").
function findAcquisitionViolations(cleaned: string): string[] {
  const violations: string[] = [];
  for (const codeWord of CODE_WORDS) {
    const wordRe = new RegExp(`\\b${codeWord}\\b`, "g");
    let match: RegExpExecArray | null;
    while ((match = wordRe.exec(cleaned)) !== null) {
      const windowStart = Math.max(0, match.index - 20);
      const windowEnd = Math.min(cleaned.length, match.index + codeWord.length + 20);
      const window = cleaned.slice(windowStart, windowEnd);
      const hit = ACQUISITION_WORDS.find((w) => containsWord(window, w));
      if (hit) violations.push(window.trim());
    }
  }
  return violations;
}

/** Returns matched fragments so callers can log what tripped. Empty = clean. */
export function findAccessCodeViolations(text: string): string[] {
  const cleaned = stripBenignPhrases(text);
  return [...findLiteralCodeViolations(cleaned), ...findAcquisitionViolations(cleaned)];
}

export interface CopySafetyInput {
  name: string;
  reason: string;
  dare: string;
}

/** Composite gate — mirrors passesQualityFilter's shape in quality.ts. */
export function passesCopySafety({ name, reason, dare }: CopySafetyInput): boolean {
  return (
    findAccessCodeViolations(name).length === 0 &&
    findAccessCodeViolations(reason).length === 0 &&
    findAccessCodeViolations(dare).length === 0
  );
}
