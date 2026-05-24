import { describe, expect, test } from "bun:test";
import { buildPrompt, parseRerankResponse } from "../../src/matcher/rerank";
import type { FtsHit } from "../../src/matcher/fts";

function fixture(over: Partial<FtsHit> = {}): FtsHit {
  return {
    id: "skill:kube-helper", source_type: "skill", name: "kube-helper", canonical_name: "kube-helper",
    description: "Kubernetes helper", installed: 1,
    bundle_id: null, source_url: null, source_sha: null, rank: 1, ...over,
  };
}

describe("buildPrompt", () => {
  test("includes goal, candidate name, and the real id (no synthetic index)", () => {
    const p = buildPrompt("build a kubernetes deploy pipeline", [fixture()]);
    expect(p).toContain("build a kubernetes deploy pipeline");
    expect(p).toContain("kube-helper");
    expect(p).toContain("skill:kube-helper");
  });
});

describe("parseRerankResponse", () => {
  test("parses well-formed JSON", () => {
    const r = parseRerankResponse('{"ranked":[{"id":"a","score":90,"why":"good fit"}],"stop_reason":"all_relevant"}');
    expect(r?.ranked[0].id).toBe("a");
    expect(r?.stop_reason).toBe("all_relevant");
  });
  test("returns null on malformed", () => {
    expect(parseRerankResponse("not json")).toBeNull();
  });
  test("extracts JSON from text containing it", () => {
    const r = parseRerankResponse('Here you go: {"ranked":[],"stop_reason":"exhausted"} done.');
    expect(r?.stop_reason).toBe("exhausted");
  });
  test("rejects ranked items missing required fields", () => {
    expect(parseRerankResponse('{"ranked":[{"id":"a"}],"stop_reason":"all_relevant"}')).toBeNull();
    expect(parseRerankResponse('{"ranked":[{"id":"a","score":50}],"stop_reason":"all_relevant"}')).toBeNull();
    expect(parseRerankResponse('{"ranked":[42],"stop_reason":"all_relevant"}')).toBeNull();
  });
  test("rejects wrong-type fields", () => {
    expect(parseRerankResponse('{"ranked":[{"id":"a","score":"high","why":"x"}],"stop_reason":"all_relevant"}')).toBeNull();
    expect(parseRerankResponse('{"ranked":[{"id":1,"score":50,"why":"x"}],"stop_reason":"all_relevant"}')).toBeNull();
  });
  test("rejects invalid stop_reason", () => {
    expect(parseRerankResponse('{"ranked":[],"stop_reason":"garbage"}')).toBeNull();
  });
});
