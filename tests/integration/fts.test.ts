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
  test("hyphens are split, not preserved (FTS5 treats '-' as NOT operator)", () => {
    expect(expandQuery("kube-helper")).not.toContain("-");
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

  test("hyphenated goal does not become FTS5 NOT — matches records the user expects", () => {
    db = openDb(dbPath); migrate(db);
    applyRecords(db, [
      rec("a", "kube-helper", "kubernetes helper utilities"),
      rec("b", "unrelated", "totally different"),
    ]);
    // Pre-fix: query "kube-helper" reaches FTS5 verbatim, parses as
    // "kube NOT helper", silently returns nothing or wrong rows.
    const hits = ftsNarrow(db, "kube-helper", 20);
    expect(hits.map(h => h.id)).toEqual(["a"]);
  });

  test("FtsHit carries canonical_name from SELECT", () => {
    db = openDb(dbPath); migrate(db);
    applyRecords(db, [rec("skill:foo", "foo", "a foo skill")]);
    const hits = ftsNarrow(db, "foo", 20);
    expect(hits[0].canonical_name).toBe("skill:foo");
  });
});
