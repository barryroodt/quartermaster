import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init";

let tmpDir: string | null = null;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "qm-init-")); });
afterEach(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); tmpDir = null; });

describe("runInit", () => {
  test("creates data dir + DB + trust.json + hash file on cold start", async () => {
    const dataDir = join(tmpDir!, "qm");
    const fakeClaude = join(tmpDir!, "claude");
    mkdirSync(join(fakeClaude, "skills"), { recursive: true });
    mkdirSync(join(fakeClaude, "plugins"), { recursive: true });
    writeFileSync(join(fakeClaude, "plugins/installed_plugins.json"), JSON.stringify({ plugins: {} }));
    const result = await runInit({
      dataDir, claudeDir: fakeClaude, claudeJson: join(tmpDir!, ".claude.json"),
      mcpServers: {}, mcpFetcher: async () => [],
    });
    expect(result.ok).toBe(true);
    expect(existsSync(join(dataDir, "inventory.db"))).toBe(true);
    expect(existsSync(join(dataDir, "trust.json"))).toBe(true);
    expect(existsSync(join(dataDir, "inventory.hash"))).toBe(true);
  });

  test("--check mode does not write DB", async () => {
    const dataDir = join(tmpDir!, "qm");
    const fakeClaude = join(tmpDir!, "claude");
    mkdirSync(join(fakeClaude, "skills"), { recursive: true });
    mkdirSync(join(fakeClaude, "plugins"), { recursive: true });
    writeFileSync(join(fakeClaude, "plugins/installed_plugins.json"), JSON.stringify({ plugins: {} }));
    const result = await runInit({
      dataDir, claudeDir: fakeClaude, claudeJson: join(tmpDir!, ".claude.json"),
      mcpServers: {}, mcpFetcher: async () => [], check: true,
    });
    expect(result.ok).toBe(true);
    expect(existsSync(join(dataDir, "inventory.db"))).toBe(false);
  });
});
