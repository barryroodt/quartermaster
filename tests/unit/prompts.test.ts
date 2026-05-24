import { describe, expect, test } from "bun:test";
import { formatUntrustedPrompt, formatDriftPrompt, formatPromotePrompt, parsePromoteChoice } from "../../src/installer/prompts";

describe("prompts", () => {
  test("formatUntrustedPrompt names source + asks confirm", () => {
    const p = formatUntrustedPrompt({ canonical: "foo/bar", source_url: "https://github.com/foo/bar", source_sha: "abc123" });
    expect(p).toContain("foo/bar");
    expect(p).toContain("abc123");
    expect(p.toLowerCase()).toContain("install");
  });

  test("formatDriftPrompt shows both SHAs", () => {
    const p = formatDriftPrompt({ canonical: "x", pinned_sha: "111", current_sha: "222", source_url: "https://github.com/x/y" });
    expect(p).toContain("111");
    expect(p).toContain("222");
  });

  test("formatPromotePrompt offers 3 options", () => {
    const p = formatPromotePrompt({ owner: "foo", repo: "bar" });
    expect(p).toContain("(1)");
    expect(p).toContain("(2)");
    expect(p).toContain("(3)");
  });

  test("parsePromoteChoice accepts 1/2/3, defaults 3", () => {
    expect(parsePromoteChoice("1")).toBe("promote-org");
    expect(parsePromoteChoice("2")).toBe("promote-repo");
    expect(parsePromoteChoice("3")).toBe("keep-prompting");
    expect(parsePromoteChoice("")).toBe("keep-prompting");
    expect(parsePromoteChoice("foo")).toBe("keep-prompting");
  });

  test("parsePromoteChoice aliases y/Y/yes to promote-org (reflex-typed yes)", () => {
    expect(parsePromoteChoice("y")).toBe("promote-org");
    expect(parsePromoteChoice("Y")).toBe("promote-org");
    expect(parsePromoteChoice("yes")).toBe("promote-org");
    expect(parsePromoteChoice("YES")).toBe("promote-org");
  });

  test("formatDriftPrompt skips diff URL for non-github source_url", () => {
    const p = formatDriftPrompt({ canonical: "x", pinned_sha: "111", current_sha: "222", source_url: "https://gitlab.com/x/y" });
    expect(p).not.toContain("/compare/");
    expect(p).toContain("111");
    expect(p).toContain("222");
  });
});
