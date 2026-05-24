import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { installSkillRaw } from "../../src/installer/skill-raw";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("installSkillRaw", () => {
  test("HTTP 404 → status=failed, error mentions 404", async () => {
    globalThis.fetch = mock(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    const r = await installSkillRaw({
      capability_id: "skill:x",
      canonical_name: "x",
      source_type: "skill",
      raw_url: "https://example.com/SKILL.md",
      skill_slug: "x",
    });
    expect(r.status).toBe("failed");
    expect(r.errors[0]).toContain("404");
  });

  test("response without YAML frontmatter → status=failed, error mentions frontmatter", async () => {
    globalThis.fetch = mock(async () => new Response("<html>404</html>", { status: 200 })) as unknown as typeof fetch;
    const r = await installSkillRaw({
      capability_id: "skill:x",
      canonical_name: "x",
      source_type: "skill",
      raw_url: "https://example.com/SKILL.md",
      skill_slug: "x",
    });
    expect(r.status).toBe("failed");
    expect(r.errors[0]).toContain("frontmatter");
  });

  test("frontmatter without name field → status=failed", async () => {
    globalThis.fetch = mock(async () => new Response("---\ndescription: only desc\n---\nbody", { status: 200 })) as unknown as typeof fetch;
    const r = await installSkillRaw({
      capability_id: "skill:x",
      canonical_name: "x",
      source_type: "skill",
      raw_url: "https://example.com/SKILL.md",
      skill_slug: "x",
    });
    expect(r.status).toBe("failed");
    expect(r.errors[0]).toContain("name");
  });
});
