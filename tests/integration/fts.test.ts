import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";
import { applyRecords } from "../../src/inventory/indexer";
import { ftsNarrow, expandQuery } from "../../src/matcher/fts";
import type { CapabilityRecord } from "../../src/inventory/types";

let tmpDir: string;
let dbPath: string;
let db: ReturnType<typeof openDb> | null = null;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "qm-fts-"));
  dbPath = join(tmpDir, "t.db");
  db = null;
});

afterEach(() => {
  if (db) { db.close(); db = null; }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function rec(id: string, name: string, desc: string): CapabilityRecord {
  return {
    id, source_type: "skill", name, canonical_name: id, description: desc, keywords: null,
    installed: 1, enabled: null, bundle_id: null, bundle_version: null, bundle_path: null,
    source_url: null, source_sha: null, last_seen_epoch: 1, content_hash: id,
  };
}

describe("expandQuery", () => {
  test("expands k8s to k8s OR kubernetes", () => {
    expect(expandQuery("k8s deploy").toLowerCase()).toContain("kubernetes");
  });
  test("strips special chars", () => {
    expect(expandQuery("foo/bar:baz")).not.toContain("/");
    expect(expandQuery("foo/bar:baz")).not.toContain(":");
  });
});

describe("ftsNarrow", () => {
  test("returns top-N rows ranked by bm25", () => {
    db = openDb(dbPath); migrate(db);
    applyRecords(db, [
      rec("a", "kube-helper", "Helps with kubernetes deploys"),
      rec("b", "unrelated", "Something else entirely"),
      rec("c", "k8s-pro", "Kubernetes cluster management"),
    ]);
    const hits = ftsNarrow(db, "kubernetes", 20);
    expect(hits.length).toBe(2);
    expect(hits.map(h => h.id).sort()).toEqual(["a", "c"]);
  });

  test("returns empty when no hits", () => {
    db = openDb(dbPath); migrate(db);
    expect(ftsNarrow(db, "nothing", 20)).toEqual([]);
  });
});
