import { describe, expect, test } from "bun:test";
import { extractFromMarkdown, extractFromJson } from "../../src/inventory/description";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(import.meta.dir, "..", "fixtures");

describe("extractFromMarkdown", () => {
  test("uses frontmatter description if present", () => {
    const md = readFileSync(join(FIXTURES, "sample-skill.md"), "utf8");
    expect(extractFromMarkdown(md)).toBe("Does the foo thing for bar reasons.");
  });

  test("falls back to first non-frontmatter line if no description", () => {
    const md = "---\nname: bar\n---\n\nHello world.";
    expect(extractFromMarkdown(md)).toBe("Hello world.");
  });

  test("returns null if no description and no body", () => {
    expect(extractFromMarkdown("---\nname: bar\n---\n")).toBeNull();
  });

  test("handles markdown with no frontmatter", () => {
    expect(extractFromMarkdown("# Title\n\nFirst line.")).toBe("# Title");
  });
});

describe("extractFromJson", () => {
  test("returns .description field", () => {
    const json = readFileSync(join(FIXTURES, "sample-plugin.json"), "utf8");
    expect(extractFromJson(json)).toBe("A plugin that foos.");
  });

  test("returns null if no description", () => {
    expect(extractFromJson('{"name":"x"}')).toBeNull();
  });

  test("returns null on invalid JSON", () => {
    expect(extractFromJson("{not json")).toBeNull();
  });

  test("returns null when .description is not a string", () => {
    expect(extractFromJson('{"description": 42}')).toBeNull();
  });
});
