import { describe, expect, test } from "bun:test";
import {
  parseSmitheryOutput,
  suggestMcpWebSearch,
} from "../../src/gap-search/mcp-registry";

describe("parseSmitheryOutput", () => {
  test("returns [] on non-JSON", () => {
    expect(parseSmitheryOutput("not json")).toEqual([]);
  });

  test("returns [] when top-level is not an array", () => {
    expect(parseSmitheryOutput(JSON.stringify({ results: [] }))).toEqual([]);
  });

  test("parses qualifiedName + description + homepage", () => {
    const raw = JSON.stringify([
      { qualifiedName: "@org/srv-a", description: "does A", homepage: "https://a.example" },
    ]);
    const hits = parseSmitheryOutput(raw);
    expect(hits.length).toBe(1);
    expect(hits[0].registry).toBe("smithery");
    expect(hits[0].canonical).toBe("@org/srv-a");
    expect(hits[0].description).toBe("does A");
    expect(hits[0].url).toBe("https://a.example");
    expect(hits[0].install_hint).toBe(
      "/qm install mcp:@org/srv-a --yes --transport-arg=npx --transport-arg=-y --transport-arg=@org/srv-a"
    );
  });

  test("falls back to repository then synthesized smithery URL", () => {
    const raw = JSON.stringify([
      { qualifiedName: "@org/srv-b", repository: "https://github.com/org/srv-b" },
      { qualifiedName: "@org/srv-c" },
    ]);
    const hits = parseSmitheryOutput(raw);
    expect(hits[0].url).toBe("https://github.com/org/srv-b");
    expect(hits[1].url).toBe("https://smithery.ai/server/%40org%2Fsrv-c");
  });

  test("skips entries with no name", () => {
    const raw = JSON.stringify([{ description: "anonymous" }, { name: "kept" }]);
    const hits = parseSmitheryOutput(raw);
    expect(hits.length).toBe(1);
    expect(hits[0].canonical).toBe("kept");
  });

  test("caps at 5 hits", () => {
    const raw = JSON.stringify(
      Array.from({ length: 10 }, (_, i) => ({ name: `s${i}` }))
    );
    expect(parseSmitheryOutput(raw).length).toBe(5);
  });
});

describe("suggestMcpWebSearch", () => {
  test("produces a web-search-suggested hit with site:github.com query", () => {
    const hit = suggestMcpWebSearch("kubernetes");
    expect(hit.registry).toBe("web-search-suggested");
    expect(hit.install_hint).toContain("site:github.com");
    expect(hit.install_hint).toContain("kubernetes");
    expect(hit.install_hint).toContain("mcp server");
  });
});
