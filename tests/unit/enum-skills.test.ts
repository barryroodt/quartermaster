import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enumerateSkills } from "../../src/inventory/enum-skills";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qm-skills-"));
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("enumerateSkills", () => {
  test("finds SKILL.md files under a root, parses frontmatter", () => {
    mkdirSync(join(tmp, "foo"));
    writeFileSync(join(tmp, "foo", "SKILL.md"), `---
name: foo
description: Foo skill.
---
Body.`);
    const records = enumerateSkills(tmp);
    expect(records.length).toBe(1);
    expect(records[0].source_type).toBe("skill");
    expect(records[0].name).toBe("foo");
    expect(records[0].description).toBe("Foo skill.");
    expect(records[0].canonical_name).toBe("foo");
    expect(records[0].installed).toBe(1);
  });

  test("skips directories without SKILL.md", () => {
    mkdirSync(join(tmp, "empty"));
    expect(enumerateSkills(tmp)).toEqual([]);
  });

  test("scoped plugin skills get plugin-slug:skill-slug canonical_name", () => {
    mkdirSync(join(tmp, "bar"));
    writeFileSync(join(tmp, "bar", "SKILL.md"), `---
name: bar
description: Bar skill.
---`);
    const records = enumerateSkills(tmp, { pluginSlug: "myplugin" });
    expect(records[0].canonical_name).toBe("myplugin:bar");
    expect(records[0].bundle_id).toBe("myplugin");
  });
});
