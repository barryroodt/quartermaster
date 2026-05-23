import { describe, expect, test } from "bun:test";
import { buildPrompt, parseRerankResponse } from "../../src/matcher/rerank";

describe("buildPrompt", () => {
  test("includes goal and candidate list", () => {
    const p = buildPrompt("build a kubernetes deploy pipeline", [
      { id: "a", name: "kube-helper", source_type: "skill", description: "Kubernetes helper", installed: 1, bundle_id: null, source_url: null, source_sha: null, rank: 1 },
    ]);
    expect(p).toContain("build a kubernetes deploy pipeline");
    expect(p).toContain("kube-helper");
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
});
