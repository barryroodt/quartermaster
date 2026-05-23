import { describe, expect, test } from "bun:test";
import { formatResults } from "../../src/matcher/format";
import type { FtsHit } from "../../src/matcher/fts";

const trustCfg = { version: 1, trusted_patterns: ["anthropic/*"], blocked_patterns: [] };

function hit(over: Partial<FtsHit>): FtsHit {
  return {
    id: "skill:x", source_type: "skill", name: "x", description: "x", installed: 1,
    bundle_id: null, source_url: null, source_sha: null, rank: 1, ...over,
  };
}

describe("formatResults", () => {
  test("buckets by installed/gap", () => {
    const result = formatResults([
      hit({ id: "a", name: "a", installed: 1 }),
      hit({ id: "b", name: "b", installed: 0 }),
    ], trustCfg);
    expect(result.installed.map(r => r.id)).toEqual(["a"]);
    expect(result.gap.map(r => r.id)).toEqual(["b"]);
  });

  test("derives trust_level per row", () => {
    const result = formatResults([
      hit({ id: "a", source_url: "https://github.com/anthropic/foo", installed: 0 }),
      hit({ id: "b", source_url: "https://github.com/other/x", installed: 0 }),
    ], trustCfg);
    expect(result.gap.find(r => r.id === "a")?.trust_level).toBe("trusted");
    expect(result.gap.find(r => r.id === "b")?.trust_level).toBe("unknown");
  });

  test("attaches invocation per row", () => {
    const result = formatResults([hit({ id: "skill:foo", source_type: "skill", name: "foo" })], trustCfg);
    expect(result.installed[0].invocation.style).toBe("skill");
  });
});
