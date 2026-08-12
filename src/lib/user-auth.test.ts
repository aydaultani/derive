import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";

// Same swap-in-a-fresh-in-memory-db pattern as spin.test.ts: @/db/client is
// a module-level singleton pointed at the committed sqlite file, so tests
// must never touch that directly.
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let testDb: TestDb;
vi.mock("@/db/client", () => ({
  get db() {
    return testDb;
  },
}));

import { authenticateUser, hashSecret } from "@/lib/user-auth";

function createTestDb(): TestDb {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (current_timestamp)
    );
  `);
  return drizzle(sqlite, { schema });
}

beforeEach(() => {
  testDb = createTestDb();
});

describe("authenticateUser", () => {
  it("rejects a missing secret with 401", async () => {
    const result = await authenticateUser("user-1", null);
    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("rejects an empty-string secret with 401", async () => {
    const result = await authenticateUser("user-1", "");
    expect(result).toEqual({ ok: false, status: 401 });
  });

  it("registers a brand-new userId on first use and succeeds", async () => {
    const result = await authenticateUser("user-1", "secret-a");
    expect(result).toEqual({ ok: true });

    const [row] = await testDb.select().from(schema.users);
    expect(row.id).toBe("user-1");
    expect(row.secretHash).toBe(hashSecret("secret-a"));
  });

  it("succeeds again when the same secret is presented for an already-registered userId", async () => {
    await authenticateUser("user-1", "secret-a");
    const result = await authenticateUser("user-1", "secret-a");
    expect(result).toEqual({ ok: true });
  });

  it("rejects a mismatched secret for an already-registered userId with 403", async () => {
    await authenticateUser("user-1", "secret-a");
    const result = await authenticateUser("user-1", "someone-elses-secret");
    expect(result).toEqual({ ok: false, status: 403 });
  });

  it("keeps distinct users independently registered", async () => {
    await authenticateUser("user-1", "secret-a");
    await authenticateUser("user-2", "secret-b");

    expect(await authenticateUser("user-1", "secret-b")).toEqual({ ok: false, status: 403 });
    expect(await authenticateUser("user-2", "secret-a")).toEqual({ ok: false, status: 403 });
    expect(await authenticateUser("user-1", "secret-a")).toEqual({ ok: true });
    expect(await authenticateUser("user-2", "secret-b")).toEqual({ ok: true });
  });
});
