import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import { findAccessCodeViolations, passesCopySafety } from "./copy-safety";

describe("findAccessCodeViolations()", () => {
  it("flags a literal digit run near a code word", () => {
    expect(findAccessCodeViolations("The code is 1234, use it before close.").length).toBeGreaterThan(0);
  });

  it("flags digits separated by dashes near a code word", () => {
    expect(findAccessCodeViolations("Punch in 4-3-2-1 on the keypad by the door.").length).toBeGreaterThan(0);
  });

  it("flags an instruction to ask for a door code, even with no digits present", () => {
    expect(findAccessCodeViolations("Ask the barista for the bathroom code.").length).toBeGreaterThan(0);
  });

  it("flags an instruction to get the gate code", () => {
    expect(findAccessCodeViolations("Get the gate code from the doorman before you go in.").length).toBeGreaterThan(0);
  });

  it("flags a PIN acquisition instruction", () => {
    expect(findAccessCodeViolations("Find out the entry PIN and share it with the group.").length).toBeGreaterThan(0);
  });

  // ---- benign phrases: these must never trip the check ----
  for (const [label, text] of [
    ["dress code", "There's a dress code, so dress up a little."],
    ["zip code", "Look up the zip code before you head out."],
    ["area code", "Call ahead — the area code is local."],
    ["postcode", "The postcode narrows it down to one block."],
    ["QR code", "Scan the QR code on the menu to order."],
    ["barcode", "Every item still has an old-school barcode sticker."],
    ["source code", "The gallery displays the source code of the piece."],
    ["map pin", "Drop a map pin at the exact bench you sat on."],
    ["pin down", "Try to pin down the year this place opened."],
    ["pinned", "It's the oldest photo pinned to the corkboard."],
  ] as const) {
    it(`does not flag benign phrase: ${label}`, () => {
      expect(findAccessCodeViolations(text)).toEqual([]);
    });
  }

  it("does not flag ordinary dare copy with no code language at all", () => {
    expect(findAccessCodeViolations("Sit at the bar and start a conversation with a stranger.")).toEqual([]);
  });
});

describe("passesCopySafety()", () => {
  it("rejects copy where only the dare field contains a violation", () => {
    expect(
      passesCopySafety({
        name: "Corner Cafe",
        reason: "A quiet spot for coffee.",
        dare: "Ask the barista for the wifi password and the bathroom code.",
      }),
    ).toBe(false);
  });

  it("accepts clean copy across all three fields", () => {
    expect(
      passesCopySafety({
        name: "Corner Cafe",
        reason: "A quiet spot for coffee.",
        dare: "Order what the person ahead of you ordered.",
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Corpus test — the actual push gate. Scans the committed data/derive.sqlite
// (shipped publicly as seed data) and fails if any cached card copy trips
// the safety check. Opens the real DB read-only so this can never mutate it.
// ---------------------------------------------------------------------------
describe("committed card_copy_cache corpus", () => {
  it("contains no dare, reason, or name text that reads like a real access code", () => {
    const dbPath = path.join(process.cwd(), "data", "derive.sqlite");
    const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = sqlite
        .prepare<[], { place_id: string; name: string; reason: string; dare: string }>(
          "SELECT place_id, name, reason, dare FROM card_copy_cache",
        )
        .all();
      expect(rows.length, "expected the committed corpus to be non-empty").toBeGreaterThan(0);

      const offenders: string[] = [];
      for (const row of rows) {
        if (!passesCopySafety(row)) {
          const violations = [
            ...findAccessCodeViolations(row.name),
            ...findAccessCodeViolations(row.reason),
            ...findAccessCodeViolations(row.dare),
          ];
          offenders.push(`${row.place_id}: ${JSON.stringify(violations)}`);
        }
      }

      expect(offenders, `access-code-like text found in committed card_copy_cache:\n${offenders.join("\n")}`).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
