import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enumerateCommands } from "../../src/inventory/enum-commands";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qm-cmd-"));
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("enumerateCommands", () => {
  test("finds .md files, parses frontmatter description", () => {
    writeFileSync(join(tmp, "foo.md"), `---
description: Foo command.
---
Body.`);
    const records = enumerateCommands(tmp);
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
    const records = enumerateCommands(tmp, { pluginSlug: "myplug" });
    expect(records[0].canonical_name).toBe("myplug/bar");
  });

  test("recurses into subdirectories", () => {
    mkdirSync(join(tmp, "sub"), { recursive: true });
    writeFileSync(join(tmp, "sub", "nested.md"), `---
description: Nested.
---`);
    const records = enumerateCommands(tmp);
    expect(records.find(r => r.name === "nested")).toBeDefined();
  });
});
