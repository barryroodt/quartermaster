import { describe, expect, test } from "bun:test";
import { runInstaller, InstallFailed } from "../../src/installer/run";
import type { InstallContext } from "../../src/installer/types";

const ctx: InstallContext = {
  capability_id: "skill:x",
  canonical_name: "x",
  source_type: "skill",
};

describe("runInstaller", () => {
  test("step success: spreads outcome over base, status from step", async () => {
    const r = await runInstaller(ctx, async () => ({
      status: "installed",
      source_sha: "abc",
      files: ["/path/x"],
      verified: true,
    }));
    expect(r.status).toBe("installed");
    expect(r.source_sha).toBe("abc");
    expect(r.files).toEqual(["/path/x"]);
    expect(r.verified).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.capability_id).toBe("skill:x");
  });

  test("InstallFailed: status=failed, error message captured", async () => {
    const r = await runInstaller(ctx, async () => {
      throw new InstallFailed("git rev-parse failed");
    });
    expect(r.status).toBe("failed");
    expect(r.errors).toEqual(["git rev-parse failed"]);
    expect(r.source_sha).toBeNull();
    expect(r.verified).toBe(false);
  });

  test("non-Error throw: stringified into errors", async () => {
    const r = await runInstaller(ctx, async () => { throw "boom"; });
    expect(r.status).toBe("failed");
    expect(r.errors).toEqual(["boom"]);
  });
});
