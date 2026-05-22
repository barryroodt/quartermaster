import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";
import { applyRecords, getAll, COLS } from "../../src/inventory/indexer";
import type { CapabilityRecord } from "../../src/inventory/types";

let tmpDir: string;
let dbPath: string;
let db: ReturnType<typeof openDb> | null = null;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "qm-idx-"));
  dbPath = join(tmpDir, "test.db");
  db = null;
});

afterEach(() => {
  if (db) { db.close(); db = null; }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function mkRecord(id: string, desc = "x"): CapabilityRecord {
  return {
    id, source_type: "skill", name: id, canonical_name: id, description: desc, keywords: null,
    installed: 1, enabled: null, bundle_id: null, bundle_version: null, bundle_path: null,
    source_url: null, source_sha: null, last_seen_epoch: 1, content_hash: desc,
  };
}

describe("indexer applyRecords", () => {
  test("inserts new records", () => {
    db = openDb(dbPath); migrate(db);
    applyRecords(db, [mkRecord("a"), mkRecord("b")]);
    expect(getAll(db).length).toBe(2);
  });

  test("updates changed content_hash, leaves unchanged rows alone", () => {
    db = openDb(dbPath); migrate(db);
    applyRecords(db, [mkRecord("a", "v1")]);
    applyRecords(db, [mkRecord("a", "v2")]);
    const all = getAll(db);
    expect(all.length).toBe(1);
    expect(all[0].description).toBe("v2");
  });

  test("removes records no longer present in current set", () => {
    db = openDb(dbPath); migrate(db);
    applyRecords(db, [mkRecord("a"), mkRecord("b")]);
    applyRecords(db, [mkRecord("a")]);
    expect(getAll(db).map(r => r.id)).toEqual(["a"]);
  });

  test("FTS5 picks up inserts", () => {
    db = openDb(dbPath); migrate(db);
    applyRecords(db, [mkRecord("foo", "kubernetes deploy helper")]);
    const hits = db.query("SELECT rowid FROM capabilities_fts WHERE capabilities_fts MATCH 'kubernetes'").all();
    expect(hits.length).toBe(1);
  });

  test("COLS matches schema column set", () => {
    db = openDb(dbPath); migrate(db);
    const cols = db.query("PRAGMA table_info(capabilities)").all() as { name: string }[];
    const schemaNames = new Set(cols.map(c => c.name));
    const colsSet = new Set<string>(COLS);
    // Every name in COLS appears in the schema.
    for (const c of COLS) {
      expect(schemaNames.has(c)).toBe(true);
    }
    // Every schema column appears in COLS.
    for (const name of schemaNames) {
      expect(colsSet.has(name)).toBe(true);
    }
  });
});
