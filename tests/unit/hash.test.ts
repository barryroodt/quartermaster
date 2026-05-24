import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signatureHash } from "../../src/inventory/hash";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qm-hash-"));
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("signatureHash", () => {
  test("returns 12-char hex string", () => {
    const h = signatureHash([]);
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  test("missing files contribute empty mtime, deterministically", () => {
    const path1 = join(tmp, "nonexistent");
    const h1 = signatureHash([path1]);
    const h2 = signatureHash([path1]);
    expect(h1).toBe(h2);
  });

  test("changing a tracked file's mtime changes the hash", () => {
    const p = join(tmp, "f");
    writeFileSync(p, "hello");
    const h1 = signatureHash([p]);
    utimesSync(p, new Date(Date.now() + 10_000), new Date(Date.now() + 10_000));
    const h2 = signatureHash([p]);
    expect(h1).not.toBe(h2);
  });
});
