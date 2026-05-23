import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";
import { applyRecords } from "../../src/inventory/indexer";
import { runSurvey } from "../../src/commands/survey";
import type { CapabilityRecord } from "../../src/inventory/types";

let tmpDir: string | null = null;
let dbPath: string;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "qm-srv-")); dbPath = join(tmpDir, "t.db"); });
afterEach(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); tmpDir = null; });

function rec(over: Partial<CapabilityRecord>): CapabilityRecord {
  return {
    id: "x", source_type: "skill", name: "x", canonical_name: "x", description: "x", keywords: null,
    installed: 1, enabled: null, bundle_id: null, bundle_version: null, bundle_path: null,
    source_url: null, source_sha: null, last_seen_epoch: 1, content_hash: "x", ...over,
  };
}

describe("runSurvey", () => {
  test("returns formatted results bucketed installed/gap", async () => {
    const db = openDb(dbPath); migrate(db);
    applyRecords(db, [
      rec({ id: "a", name: "kube-skill", description: "kubernetes deploy helper", installed: 1 }),
      rec({ id: "b", name: "react-skill", description: "react component patterns", installed: 0 }),
    ]);
    db.close();
    const result = await runSurvey({
      dataDir: tmpDir!,
      dbPath,
      goal: "kubernetes",
      rerankImpl: async (_g, hits) => ({
        ranked: hits.slice(0, 5).map(h => ({ id: h.id, score: 80, why: "ok" })),
        stop_reason: "all_relevant",
      }),
      gapSearchImpl: async () => [],
    });
    expect(result.installed.length + result.gap.length).toBeGreaterThan(0);
    expect(result.external_gaps).toEqual([]);
  });

  test("falls back to FTS-only when rerank returns null", async () => {
    const db = openDb(dbPath); migrate(db);
    applyRecords(db, [rec({ id: "a", description: "kubernetes deploy" })]);
    db.close();
    const result = await runSurvey({
      dataDir: tmpDir!, dbPath, goal: "kubernetes",
      rerankImpl: async () => null,
      gapSearchImpl: async () => [],
    });
    expect(result.degraded).toBe(true);
    expect(result.installed.length + result.gap.length).toBeGreaterThan(0);
    expect(result.external_gaps).toEqual([]);
  });

  test("empty inventory returns refuse signal", async () => {
    const db = openDb(dbPath); migrate(db); db.close();
    const result = await runSurvey({
      dataDir: tmpDir!, dbPath, goal: "anything",
      rerankImpl: async () => null,
      gapSearchImpl: async () => [],
    });
    expect(result.refused).toBe(true);
    expect(result.external_gaps).toEqual([]);
  });

  test("thin installed bucket triggers gap-search and surfaces external gaps", async () => {
    const db = openDb(dbPath); migrate(db);
    // Single installed hit → below THIN_INSTALLED_THRESHOLD (3) → triggers gap search.
    applyRecords(db, [rec({ id: "a", description: "kubernetes deploy", installed: 1 })]);
    db.close();
    const result = await runSurvey({
      dataDir: tmpDir!, dbPath, goal: "kubernetes",
      rerankImpl: async (_g, hits) => ({
        ranked: hits.map(h => ({ id: h.id, score: 80, why: "ok" })),
        stop_reason: "all_relevant",
      }),
      gapSearchImpl: async () => [
        { registry: "skills.sh", name: "kube", canonical: "owner/repo@kube", installs: 42, url: "https://github.com/owner/repo" },
        { registry: "brew", name: "kubectl", canonical: "kubectl", url: "https://formulae.brew.sh/formula/kubectl" },
      ],
    });
    expect(result.external_gaps.length).toBe(2);
    expect(result.external_gaps[0].capability_id).toBe("skill:skills-sh:owner/repo@kube");
    expect(result.external_gaps[0].install_command).toBe("/qm install skill:skills-sh:owner/repo@kube");
    expect(result.external_gaps[1].capability_id).toBe("cli:brew:kubectl");
  });
});
