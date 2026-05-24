import { describe, expect, test } from "bun:test";
import { formatResults } from "../../src/matcher/format";
import type { FtsHit } from "../../src/matcher/fts";

const trustCfg = { version: 1, trusted_patterns: ["anthropic/*"], blocked_patterns: ["evil/*"] };

function hit(over: Partial<FtsHit>): FtsHit {
  return {
    id: "skill:x", source_type: "skill", name: "x", canonical_name: "x",
    description: "x", installed: 1,
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

  test("derives trust_level per row (trusted, unknown, blocked)", () => {
    const result = formatResults([
      hit({ id: "a", source_url: "https://github.com/anthropic/foo", installed: 0 }),
      hit({ id: "b", source_url: "https://github.com/other/x", installed: 0 }),
      hit({ id: "c", source_url: "https://github.com/evil/x", installed: 0 }),
    ], trustCfg);
    expect(result.gap.find(r => r.id === "a")?.trust_level).toBe("trusted");
    expect(result.gap.find(r => r.id === "b")?.trust_level).toBe("unknown");
    expect(result.gap.find(r => r.id === "c")?.trust_level).toBe("blocked");
  });

  test("attaches invocation per row using canonical_name (not id-surgery)", () => {
    const result = formatResults([
      hit({ id: "skill:foo", source_type: "skill", name: "foo", canonical_name: "superpowers:brainstorming" }),
    ], trustCfg);
    const inv = result.installed[0].invocation;
    expect(inv.style).toBe("skill");
    if (inv.style === "skill") expect(inv.name).toBe("superpowers:brainstorming");
  });
});
