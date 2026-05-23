import { describe, expect, test } from "bun:test";
import { matches, validatePattern } from "../../src/trust/patterns";

describe("matches", () => {
  test("exact match", () => { expect(matches("anthropic/foo", "anthropic/foo")).toBe(true); });
  test("trailing wildcard match", () => { expect(matches("anthropic/foo", "anthropic/*")).toBe(true); });
  test("case-insensitive", () => { expect(matches("Anthropic/Foo", "anthropic/*")).toBe(true); });
  test("non-match", () => { expect(matches("other/foo", "anthropic/*")).toBe(false); });
  test("leading wildcard rejected (no match)", () => { expect(matches("anthropic/foo", "*/foo")).toBe(false); });
});

describe("validatePattern", () => {
  test("accepts owner/repo", () => { expect(() => validatePattern("anthropic/foo")).not.toThrow(); });
  test("accepts owner/*", () => { expect(() => validatePattern("anthropic/*")).not.toThrow(); });
  test("rejects */*", () => { expect(() => validatePattern("*/*")).toThrow(); });
  test("rejects bare *", () => { expect(() => validatePattern("*")).toThrow(); });
  test("rejects empty", () => { expect(() => validatePattern("")).toThrow(); });
  test("rejects bare owner (no slash) — matcher cannot honor", () => {
    expect(() => validatePattern("anthropic")).toThrow();
  });
  test("rejects mid/trailing wildcard variants — matcher only honors '/*' suffix", () => {
    expect(() => validatePattern("anthropic/foo*")).toThrow();
    expect(() => validatePattern("anthropic*/*")).toThrow();
  });
});
