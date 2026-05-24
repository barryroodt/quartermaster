import { describe, expect, test } from "bun:test";
import {
  parseSkillsShOutput,
  parseBrewOutput,
  type RegistryHit,
} from "../../src/gap-search/registries";

describe("parseSkillsShOutput", () => {
  test("parses npx skills find output", () => {
    const raw = `foo/bar@my-skill    42 installs
└ https://skills.sh/foo/bar/my-skill
other/baz@thing    10 installs
└ https://skills.sh/other/baz/thing`;
    const hits = parseSkillsShOutput(raw);
    expect(hits.length).toBe(2);
    expect(hits[0]).toEqual({
      registry: "skills.sh",
      name: "my-skill",
      canonical: "foo/bar@my-skill",
      installs: 42,
      url: "https://skills.sh/foo/bar/my-skill",
    } satisfies RegistryHit);
  });

  test("returns empty on no results", () => {
    expect(parseSkillsShOutput("no skills found")).toEqual([]);
  });

  test("skips hit when URL absent within 3 lines", () => {
    const raw = `foo/bar@my-skill    42 installs
some description text
more description
another line
https://skills.sh/foo/bar/my-skill`;
    // URL is on the 4th non-blank line after the canonical → out of window → skip
    expect(parseSkillsShOutput(raw)).toEqual([]);
  });
});

describe("parseBrewOutput", () => {
  test("parses brew search output", () => {
    const raw = `foo
bar
baz`;
    const hits = parseBrewOutput(raw);
    expect(hits.length).toBe(3);
    expect(hits[0]).toEqual({
      registry: "brew",
      name: "foo",
      canonical: "foo",
      url: "https://formulae.brew.sh/formula/foo",
    } satisfies RegistryHit);
  });

  test("returns empty on no results", () => {
    expect(parseBrewOutput("")).toEqual([]);
  });

  test("caps at 10 hits", () => {
    const raw = Array.from({ length: 25 }, (_, i) => `pkg${i}`).join("\n");
    const hits = parseBrewOutput(raw);
    expect(hits.length).toBe(10);
    expect(hits[0].name).toBe("pkg0");
    expect(hits[9].name).toBe("pkg9");
  });
});
