import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";
import { getPin, writePin, driftCheck } from "../../src/trust/pins";

let tmpDir: string;
let dbPath: string;
let db: ReturnType<typeof openDb> | null = null;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "qm-pins-"));
  dbPath = join(tmpDir, "t.db");
  db = openDb(dbPath);
  migrate(db);
});

afterEach(() => {
  if (db) { db.close(); db = null; }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("pins", () => {
  test("writePin then getPin round-trips", () => {
    writePin(db!, { capability_id: "skill:x", source_sha: "abc", pinned_by: "auto-trusted", source_url: "https://github.com/x/y" });
    const p = getPin(db!, "skill:x");
    expect(p?.source_sha).toBe("abc");
    expect(p?.pinned_by).toBe("auto-trusted");
    expect(typeof p?.pinned_at).toBe("number");
  });

  test("driftCheck: no pin → no-pin", () => {
    expect(driftCheck(db!, "skill:x", "abc")).toBe("no-pin");
  });

  test("driftCheck: match → match", () => {
    writePin(db!, { capability_id: "skill:x", source_sha: "abc", pinned_by: "auto-trusted", source_url: "u" });
    expect(driftCheck(db!, "skill:x", "abc")).toBe("match");
  });

  test("driftCheck: different SHA → drift", () => {
    writePin(db!, { capability_id: "skill:x", source_sha: "abc", pinned_by: "auto-trusted", source_url: "u" });
    expect(driftCheck(db!, "skill:x", "xyz")).toBe("drift");
  });

  test("upsert: re-writing capability_id with new SHA overwrites the row", () => {
    writePin(db!, { capability_id: "skill:x", source_sha: "abc", pinned_by: "auto-trusted", source_url: "u" });
    writePin(db!, { capability_id: "skill:x", source_sha: "def", pinned_by: "user-confirm", source_url: "u" });
    const p = getPin(db!, "skill:x");
    expect(p?.source_sha).toBe("def");
    expect(p?.pinned_by).toBe("user-confirm");
  });

  test("re-pin with same SHA preserves original pinned_at (audit trail)", () => {
    writePin(db!, { capability_id: "skill:x", source_sha: "abc", pinned_by: "auto-trusted", source_url: "u", pinned_at: 1000 });
    writePin(db!, { capability_id: "skill:x", source_sha: "abc", pinned_by: "auto-trusted", source_url: "u", pinned_at: 2000 });
    expect(getPin(db!, "skill:x")?.pinned_at).toBe(1000);
  });

  test("re-pin with different SHA updates pinned_at", () => {
    writePin(db!, { capability_id: "skill:x", source_sha: "abc", pinned_by: "auto-trusted", source_url: "u", pinned_at: 1000 });
    writePin(db!, { capability_id: "skill:x", source_sha: "def", pinned_by: "auto-trusted", source_url: "u", pinned_at: 2000 });
    expect(getPin(db!, "skill:x")?.pinned_at).toBe(2000);
  });
});
