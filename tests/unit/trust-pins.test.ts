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
  db = null;
});

afterEach(() => {
  if (db) { db.close(); db = null; }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("pins", () => {
  test("writePin then getPin round-trips", () => {
    db = openDb(dbPath);
    migrate(db);
    writePin(db, { capability_id: "skill:x", source_sha: "abc", pinned_by: "auto-trusted", source_url: "https://github.com/x/y" });
    const p = getPin(db, "skill:x");
    expect(p?.source_sha).toBe("abc");
  });

  test("driftCheck: no pin → no-pin", () => {
    db = openDb(dbPath);
    migrate(db);
    expect(driftCheck(db, "skill:x", "abc")).toBe("no-pin");
  });

  test("driftCheck: match → match", () => {
    db = openDb(dbPath);
    migrate(db);
    writePin(db, { capability_id: "skill:x", source_sha: "abc", pinned_by: "auto-trusted", source_url: "u" });
    expect(driftCheck(db, "skill:x", "abc")).toBe("match");
  });

  test("driftCheck: different SHA → drift", () => {
    db = openDb(dbPath);
    migrate(db);
    writePin(db, { capability_id: "skill:x", source_sha: "abc", pinned_by: "auto-trusted", source_url: "u" });
    expect(driftCheck(db, "skill:x", "xyz")).toBe("drift");
  });
});
