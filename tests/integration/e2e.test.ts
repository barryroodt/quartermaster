import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init";
import { runSurvey } from "../../src/commands/survey";

let tmpDir: string | null = null;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "qm-e2e-"));
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

describe("end-to-end: init → survey", () => {
  test("indexes fixture skills and matches a kubernetes goal", async () => {
    const dataDir = join(tmpDir!, "qm");
    const claudeDir = join(tmpDir!, "claude");
    cpSync(join(import.meta.dir, "..", "fixtures", "fake-claude"), claudeDir, { recursive: true });
    writeFileSync(join(tmpDir!, ".claude.json"), JSON.stringify({ mcpServers: {} }));

    const initResult = await runInit({
      dataDir,
      claudeDir,
      claudeJson: join(tmpDir!, ".claude.json"),
      mcpServers: {},
      mcpFetcher: async () => [],
    });
    expect(initResult.ok).toBe(true);
    expect(initResult.counts.skill).toBeGreaterThanOrEqual(2);

    const surveyResult = await runSurvey({
      dataDir,
      dbPath: join(dataDir, "inventory.db"),
      goal: "kubernetes deployment",
      rerankImpl: async (_g, hits) => ({
        ranked: hits.map(h => ({ id: h.id, score: 90, why: "match" })),
        stop_reason: "all_relevant",
      }),
    });
    const all = [...surveyResult.installed, ...surveyResult.gap];
    expect(all.find(r => r.name === "kube-helper")).toBeDefined();
  });
});
