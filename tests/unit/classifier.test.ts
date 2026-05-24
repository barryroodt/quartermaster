import { describe, expect, test } from "bun:test";
import { classify } from "../../src/classifier/intent";

describe("classify", () => {
  test("detects planning + tech", () => {
    const r = classify("I want to build a React dashboard with Supabase auth");
    expect(r.planning).toBe(true);
    expect(r.techKeywords).toContain("react");
    expect(r.techKeywords).toContain("supabase");
    expect(r.fire).toBe(true);
  });

  test("planning without tech does not fire", () => {
    const r = classify("how should I plan my day");
    expect(r.fire).toBe(false);
  });

  test("tech without planning does not fire", () => {
    const r = classify("the react component is broken");
    expect(r.fire).toBe(false);
  });

  test("neither does not fire", () => {
    expect(classify("hello").fire).toBe(false);
  });
});
