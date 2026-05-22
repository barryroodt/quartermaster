import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enumeratePlugins } from "../../src/inventory/enum-plugins";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qm-plugins-"));
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("enumeratePlugins", () => {
  test("reads installed_plugins.json, fetches description from each plugin.json", () => {
    const installDir = join(tmp, "foo-plugin");
    mkdirSync(join(installDir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(installDir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "foo-plugin", description: "A plugin." }),
    );
    const manifest = {
      version: 2,
      plugins: {
        "foo@bar": [
          {
            scope: "user",
            installPath: installDir,
            version: "1.0.0",
            gitCommitSha: "abc123",
          },
        ],
      },
    };
    const manifestPath = join(tmp, "installed_plugins.json");
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const enabled = new Set(["foo@bar"]);
    const records = enumeratePlugins(manifestPath, enabled);
    expect(records.length).toBe(1);
    expect(records[0].source_type).toBe("plugin");
    expect(records[0].canonical_name).toBe("foo@bar");
    expect(records[0].description).toBe("A plugin.");
    expect(records[0].bundle_version).toBe("1.0.0");
    expect(records[0].source_sha).toBe("abc123");
    expect(records[0].enabled).toBe(1);
  });

  test("marks plugin not in enabled set as enabled:0", () => {
    const installDir = join(tmp, "foo-plugin");
    mkdirSync(join(installDir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(installDir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "foo-plugin" }),
    );
    const manifest = {
      version: 2,
      plugins: {
        "foo@bar": [{ scope: "user", installPath: installDir, version: "1.0.0" }],
      },
    };
    const manifestPath = join(tmp, "installed_plugins.json");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const records = enumeratePlugins(manifestPath, new Set());
    expect(records[0].enabled).toBe(0);
  });

  test("returns empty array if manifest absent", () => {
    expect(enumeratePlugins("/nonexistent/path.json", new Set())).toEqual([]);
  });

  test("returns empty array on corrupt manifest JSON", () => {
    const manifestPath = join(tmp, "installed_plugins.json");
    writeFileSync(manifestPath, "{ not json");
    expect(enumeratePlugins(manifestPath, new Set())).toEqual([]);
  });

  test("emits record with null description when plugin.json missing", () => {
    const installDir = join(tmp, "no-pj-plugin");
    mkdirSync(installDir, { recursive: true });
    // intentionally omit .claude-plugin/plugin.json
    const manifest = { version: 2, plugins: { "nopj@m": [{ scope: "user", installPath: installDir, version: "1.0.0" }] } };
    const manifestPath = join(tmp, "installed_plugins.json");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const records = enumeratePlugins(manifestPath, new Set());
    expect(records.length).toBe(1);
    expect(records[0].description).toBeNull();
  });
});
