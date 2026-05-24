import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate, currentVersion } from "../../src/db/migrate";

let tmpDir: string;
let dbPath: string;
let db: ReturnType<typeof openDb> | null = null;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "qm-test-"));
  dbPath = join(tmpDir, "test.db");
  db = null;
});

afterEach(() => {
  if (db) { db.close(); db = null; }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("migrate", () => {
  test("applies schema to empty db, reaches version 1", () => {
    db = openDb(dbPath);
    migrate(db);
    expect(currentVersion(db)).toBe(1);
  });

  test("is idempotent — second run is a no-op", () => {
    db = openDb(dbPath);
    migrate(db);
    migrate(db);
    expect(currentVersion(db)).toBe(1);
  });

  test("creates capabilities, install_history, trust_pins, mcp_tool_cache tables", () => {
    db = openDb(dbPath);
    migrate(db);
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain("capabilities");
    expect(names).toContain("install_history");
    expect(names).toContain("trust_pins");
    expect(names).toContain("mcp_tool_cache");
    expect(names).toContain("capabilities_fts");
  });
});
