import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyInstall } from "../../src/installer/verify";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qm-verify-"));
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("verifyInstall", () => {
  test("ok when all files exist and non-empty", () => {
    const f = join(tmp, "x");
    writeFileSync(f, "content");
    expect(verifyInstall([f]).ok).toBe(true);
  });

  test("not ok when file missing", () => {
    expect(verifyInstall(["/nonexistent/x"]).ok).toBe(false);
  });

  test("not ok when file empty", () => {
    const f = join(tmp, "x");
    writeFileSync(f, "");
    expect(verifyInstall([f]).ok).toBe(false);
  });
});
