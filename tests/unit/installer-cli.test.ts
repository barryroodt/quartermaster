import { describe, expect, test } from "bun:test";
import { installCli } from "../../src/installer/cli";

describe("installCli", () => {
  test("returns skipped with the manual command in errors", async () => {
    const r = await installCli({
      capability_id: "cli:bin:jq",
      canonical_name: "bin:jq",
      source_type: "cli",
      command: "brew install jq",
    });
    expect(r.status).toBe("skipped");
    expect(r.verified).toBe(false);
    expect(r.source_sha).toBeNull();
    expect(r.errors[0]).toContain("brew install jq");
  });
});
