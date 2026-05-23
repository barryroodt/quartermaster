import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrust, trustLevel } from "../../src/trust/derive";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qm-tr-"));
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("loadTrust", () => {
  test("returns empty config when file absent", () => {
    const cfg = loadTrust("/nonexistent.json");
    expect(cfg.trusted_patterns).toEqual([]);
    expect(cfg.blocked_patterns).toEqual([]);
  });

  test("reads patterns from file", () => {
    const p = join(tmp, "trust.json");
    writeFileSync(p, JSON.stringify({ version: 1, trusted_patterns: ["a/*"], blocked_patterns: ["b/c"] }));
    const cfg = loadTrust(p);
    expect(cfg.trusted_patterns).toEqual(["a/*"]);
    expect(cfg.blocked_patterns).toEqual(["b/c"]);
  });
});

describe("trustLevel", () => {
  const cfg = { version: 1, trusted_patterns: ["anthropic/*"], blocked_patterns: ["evil/*"] };
  test("trusted match", () => { expect(trustLevel("https://github.com/anthropic/foo", cfg)).toBe("trusted"); });
  test("blocked match", () => { expect(trustLevel("https://github.com/evil/x", cfg)).toBe("blocked"); });
  test("unknown when no match", () => { expect(trustLevel("https://github.com/other/x", cfg)).toBe("unknown"); });
  test("blocked wins over trusted", () => {
    const c2 = { version: 1, trusted_patterns: ["foo/*"], blocked_patterns: ["foo/bar"] };
    expect(trustLevel("https://github.com/foo/bar", c2)).toBe("blocked");
  });
  test("null url → unknown", () => { expect(trustLevel(null, cfg)).toBe("unknown"); });
});
