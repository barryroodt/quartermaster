import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enumerateAgents } from "../../src/inventory/enum-agents";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qm-agt-"));
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("enumerateAgents", () => {
  test("finds .md files, source_type=agent", () => {
    writeFileSync(join(tmp, "foo.md"), `---
description: Foo agent.
---`);
    const records = enumerateAgents(tmp);
    expect(records.length).toBe(1);
    expect(records[0].source_type).toBe("agent");
    expect(records[0].canonical_name).toBe("foo");
  });

  test("plugin scope uses colon separator", () => {
    writeFileSync(join(tmp, "bar.md"), `---
description: Bar.
---`);
    const records = enumerateAgents(tmp, { pluginSlug: "myplug" });
    expect(records[0].canonical_name).toBe("myplug:bar");
  });

  test("recurses into subdirectories", () => {
    mkdirSync(join(tmp, "sub"), { recursive: true });
    writeFileSync(join(tmp, "sub", "nested.md"), `---
description: Nested.
---`);
    const records = enumerateAgents(tmp);
    expect(records.find(r => r.name === "nested")).toBeDefined();
  });
});
