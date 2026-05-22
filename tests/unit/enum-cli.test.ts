import { describe, expect, test } from "bun:test";
import { enumerateCli } from "../../src/inventory/enum-cli";

describe("enumerateCli", () => {
  test("emits cli records for binaries on PATH", () => {
    // git is on PATH on dev machines
    const known = { git: { description: "Git VCS", registry: "system" as const } };
    const records = enumerateCli(known, {});
    const git = records.find(r => r.name === "git");
    expect(git).toBeDefined();
    expect(git?.source_type).toBe("cli");
    expect(git?.canonical_name).toBe("bin:git");
    expect(git?.description).toBe("Git VCS");
    expect(git?.installed).toBe(1);
  });

  test("omits binaries not on PATH", () => {
    const known = { "definitely-not-a-real-binary-xyzzy": { description: "x", registry: "brew" as const } };
    const records = enumerateCli(known, {});
    expect(records.length).toBe(0);
  });

  test("merges extras over known map", () => {
    const known = { git: { description: "Built-in", registry: "system" as const } };
    const extras = { git: { description: "Custom git desc", registry: "brew" as const } };
    const records = enumerateCli(known, extras);
    expect(records.find(r => r.name === "git")?.description).toBe("Custom git desc");
  });
});
