import { describe, expect, test } from "bun:test";
import { buildWebSearchQuery } from "../../src/gap-search/websearch";

describe("buildWebSearchQuery", () => {
  test("skill template", () => {
    expect(buildWebSearchQuery("skill", "react")).toBe('site:github.com "SKILL.md" claude react');
  });
  test("mcp_server template", () => {
    expect(buildWebSearchQuery("mcp_server", "linear")).toBe('"mcp server" linear site:github.com');
  });
  test("cli template", () => {
    expect(buildWebSearchQuery("cli", "yaml")).toBe("yaml CLI tool site:github.com OR site:crates.io");
  });
});
