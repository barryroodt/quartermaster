import { describe, expect, test } from "bun:test";
import { deriveBundleKind, deriveInvocation } from "../../src/matcher/derive";

describe("deriveBundleKind", () => {
  test("@-form is plugin", () => { expect(deriveBundleKind("claude-mem@thedotmack")).toBe("plugin"); });
  test("bare slug is marketplace", () => { expect(deriveBundleKind("superpowers-marketplace")).toBe("marketplace"); });
  test("null returns null", () => { expect(deriveBundleKind(null)).toBeNull(); });
});

describe("deriveInvocation", () => {
  test("skill", () => {
    expect(deriveInvocation("skill", "superpowers:brainstorming")).toEqual({
      style: "skill", name: "superpowers:brainstorming",
    });
  });
  test("command prefixes /", () => {
    expect(deriveInvocation("command", "qm-survey")).toEqual({ style: "slash", name: "/qm-survey" });
  });
  test("cli strips bin: prefix", () => {
    expect(deriveInvocation("cli", "bin:gh")).toEqual({ style: "bash", example: "gh" });
  });
  test("mcp_tool", () => {
    expect(deriveInvocation("mcp_tool", "mcp__context7__query-docs")).toEqual({
      style: "tool", name: "mcp__context7__query-docs",
    });
  });
});
