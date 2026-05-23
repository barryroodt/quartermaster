import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";
import { applyRecords } from "../../src/inventory/indexer";
import { runList } from "../../src/commands/list";
import { runTrustAdd, runTrustList } from "../../src/commands/trust";
import { runPrune } from "../../src/commands/prune";
import type { CapabilityRecord, SourceType } from "../../src/inventory/types";

let tmpDir: string | null = null;
let dbPath: string;
let trustPath: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "qm-cmd-"));
  dbPath = join(tmpDir, "t.db");
  trustPath = join(tmpDir, "trust.json");
  writeFileSync(trustPath, JSON.stringify({ version: 1, trusted_patterns: [], blocked_patterns: [] }));
});
afterEach(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); tmpDir = null; });

function rec(id: string, src: SourceType, inst: 0 | 1): CapabilityRecord {
  return {
    id, source_type: src, name: id, canonical_name: id, description: null, keywords: null,
    installed: inst, enabled: null, bundle_id: null, bundle_version: null, bundle_path: null,
    source_url: null, source_sha: null, last_seen_epoch: 1, content_hash: id,
  };
}

describe("runList", () => {
  test("returns all rows or filtered by source_type", () => {
    const db = openDb(dbPath); migrate(db);
    applyRecords(db, [rec("a", "skill", 1), rec("b", "cli", 1)]);
    db.close();
    expect(runList(dbPath).length).toBe(2);
    expect(runList(dbPath, "skill").length).toBe(1);
  });
});

describe("runTrustAdd / runTrustList", () => {
  test("adds pattern and lists it", () => {
    runTrustAdd(trustPath, "anthropic/*");
    const list = runTrustList(trustPath);
    expect(list.trusted_patterns).toContain("anthropic/*");
  });
  test("rejects invalid pattern", () => {
    expect(() => runTrustAdd(trustPath, "*/*")).toThrow();
  });
});

describe("runPrune", () => {
  test("removes rows with installed=0", () => {
    const db = openDb(dbPath); migrate(db);
    applyRecords(db, [rec("a", "skill", 1), rec("b", "skill", 0)]);
    db.close();
    const removed = runPrune(dbPath);
    expect(removed).toBe(1);
    const remaining = runList(dbPath);
    expect(remaining.map(r => r.id)).toEqual(["a"]);
  });
});
