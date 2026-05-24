import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enumerateMdTree } from "../../src/inventory/enum-md-tree";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qm-mdt-"));
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("enumerateMdTree (command)", () => {
  test("finds .md files, parses frontmatter description", () => {
    writeFileSync(join(tmp, "foo.md"), `---
description: Foo command.
---
Body.`);
    const records = enumerateMdTree(tmp, "command");
    expect(records.length).toBe(1);
    expect(records[0].source_type).toBe("command");
    expect(records[0].name).toBe("foo");
    expect(records[0].canonical_name).toBe("foo");
    expect(records[0].description).toBe("Foo command.");
  });

  test("plugin scope prefixes canonical_name", () => {
    writeFileSync(join(tmp, "bar.md"), `---
description: Bar.
---`);
    const records = enumerateMdTree(tmp, "command", { pluginSlug: "myplug" });
    expect(records[0].canonical_name).toBe("myplug/bar");
  });

  test("recurses into subdirectories", () => {
    mkdirSync(join(tmp, "sub"), { recursive: true });
    writeFileSync(join(tmp, "sub", "nested.md"), `---
description: Nested.
---`);
    const records = enumerateMdTree(tmp, "command");
    expect(records.find(r => r.name === "nested")).toBeDefined();
  });
});

describe("enumerateMdTree (agent)", () => {
  test("finds .md files, source_type=agent", () => {
    writeFileSync(join(tmp, "foo.md"), `---
description: Foo agent.
---`);
    const records = enumerateMdTree(tmp, "agent");
    expect(records.length).toBe(1);
    expect(records[0].source_type).toBe("agent");
    expect(records[0].canonical_name).toBe("foo");
  });

  test("plugin scope uses colon separator", () => {
    writeFileSync(join(tmp, "bar.md"), `---
description: Bar.
---`);
    const records = enumerateMdTree(tmp, "agent", { pluginSlug: "myplug" });
    expect(records[0].canonical_name).toBe("myplug:bar");
  });

  test("recurses into subdirectories", () => {
    mkdirSync(join(tmp, "sub"), { recursive: true });
    writeFileSync(join(tmp, "sub", "nested.md"), `---
description: Nested.
---`);
    const records = enumerateMdTree(tmp, "agent");
    expect(records.find(r => r.name === "nested")).toBeDefined();
  });
});
