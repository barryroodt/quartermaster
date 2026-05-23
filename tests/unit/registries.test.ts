import { describe, expect, test, mock } from "bun:test";
import { searchSkillsSh, type RegistryHit } from "../../src/gap-search/registries";

describe("searchSkillsSh", () => {
  test("parses npx skills find output", async () => {
    const runner = mock(async () => `foo/bar@my-skill    42 installs
└ https://skills.sh/foo/bar/my-skill
other/baz@thing    10 installs
└ https://skills.sh/other/baz/thing`);
    const hits = await searchSkillsSh("test", runner);
    expect(hits.length).toBe(2);
    expect(hits[0]).toEqual({
      name: "my-skill",
      canonical: "foo/bar@my-skill",
      installs: 42,
      url: "https://skills.sh/foo/bar/my-skill",
      registry: "skills.sh",
    } satisfies RegistryHit);
  });

  test("returns empty on no results", async () => {
    const runner = mock(async () => "no skills found");
    expect(await searchSkillsSh("zzz", runner)).toEqual([]);
  });
});
