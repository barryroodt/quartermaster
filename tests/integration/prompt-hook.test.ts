import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook } from "../../src/hooks/prompt-hook";

let tmpDir: string | null = null;

beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "qm-hook-")); });
afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

describe("runHook", () => {
  test("cold state: emits nudge + writes marker", () => {
    const dataDir = join(tmpDir!, "qm");
    mkdirSync(dataDir, { recursive: true });
    const result = runHook({ prompt: "hello", dataDir, hashInputs: [] });
    expect(result.output).toContain("not built");
    expect(existsSync(join(dataDir, ".session-init-shown"))).toBe(true);
  });

  test("cold state second call: silent (marker present)", () => {
    const dataDir = join(tmpDir!, "qm");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, ".session-init-shown"), "");
    const result = runHook({ prompt: "hello", dataDir, hashInputs: [] });
    expect(result.output).toBe("");
  });

  test("warm + no planning intent: silent", () => {
    const dataDir = join(tmpDir!, "qm");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "inventory.db"), "");
    writeFileSync(join(dataDir, "inventory.hash"), "abc123def456");
    const result = runHook({ prompt: "fix the bug", dataDir, hashInputs: [] });
    expect(result.output).toBe("");
  });

  test("warm + planning intent + tech keyword: emits nudge", () => {
    const dataDir = join(tmpDir!, "qm");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "inventory.db"), "");
    writeFileSync(join(dataDir, "inventory.hash"), "abc123def456");
    const result = runHook({ prompt: "I want to build a kubernetes deployment pipeline", dataDir, hashInputs: [] });
    expect(result.output).toContain("planning intent");
    expect(result.output).toContain("kubernetes");
  });
});
