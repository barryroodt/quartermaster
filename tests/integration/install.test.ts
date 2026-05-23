import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";
import { applyRecords } from "../../src/inventory/indexer";
import { runInstall, parseCapabilityId } from "../../src/commands/install";
import { getPin } from "../../src/trust/pins";
import { getHistory } from "../../src/installer/history";
import type { InstallContext, InstallOutcome } from "../../src/installer/types";
import type { CapabilityRecord } from "../../src/inventory/types";

let tmpDir: string | null = null;
let dbPath: string;
let trustPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "qm-install-"));
  dbPath = join(tmpDir, "inventory.db");
  trustPath = join(tmpDir, "trust.json");
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

function writeTrust(trusted: string[] = [], blocked: string[] = []): void {
  writeFileSync(trustPath, JSON.stringify({ version: 1, trusted_patterns: trusted, blocked_patterns: blocked }));
}

function stubInstaller(sha: string | null, status: InstallOutcome["status"] = "installed") {
  return async (ctx: InstallContext): Promise<InstallOutcome> => ({
    capability_id: ctx.capability_id,
    status,
    source_sha: sha,
    verified: true,
    files: ["/fake/SKILL.md"],
    errors: [],
  });
}

describe("parseCapabilityId", () => {
  test("skills-sh shape", () => {
    const r = parseCapabilityId("skill:skills-sh:foo/bar@my-skill");
    expect(r.kind).toBe("skills-sh");
    if (r.kind === "skills-sh") {
      expect(r.canonical).toBe("foo/bar@my-skill");
      expect(r.owner).toBe("foo");
      expect(r.repo).toBe("bar");
      expect(r.url).toBe("https://github.com/foo/bar");
    }
  });

  test("plugin shape", () => {
    const r = parseCapabilityId("plugin:claude:foo/bar");
    expect(r.kind).toBe("plugin");
    if (r.kind === "plugin") {
      expect(r.owner).toBe("foo");
      expect(r.repo).toBe("bar");
    }
  });

  test("brew-cli shape", () => {
    const r = parseCapabilityId("cli:brew:jq");
    expect(r.kind).toBe("brew-cli");
    if (r.kind === "brew-cli") expect(r.name).toBe("jq");
  });

  test("skill:raw → raw-skill (deferred)", () => {
    const r = parseCapabilityId("skill:raw:https://example.com/SKILL.md:my-slug");
    expect(r.kind).toBe("raw-skill");
  });

  test("mcp:* → mcp", () => {
    const r = parseCapabilityId("mcp:my-server");
    expect(r.kind).toBe("mcp");
    if (r.kind === "mcp") expect(r.name).toBe("my-server");
  });

  test("garbage → unsupported", () => {
    const r = parseCapabilityId("not-a-real-shape");
    expect(r.kind).toBe("unsupported");
  });
});

describe("runInstall", () => {
  test("trusted skills.sh install writes trust_pins + install_history", async () => {
    writeTrust(["foo/*"]);
    const report = await runInstall({
      dbPath, trustPath,
      capabilityId: "skill:skills-sh:foo/bar@my-skill",
      yes: false, yesDrift: false, transportArgs: [],
      installerImpls: { skillsSh: stubInstaller("sha1") },
    });
    expect(report.outcome.status).toBe("installed");
    expect(report.trust_action).toBe("auto-trusted");

    const db = openDb(dbPath); migrate(db);
    const pin = getPin(db, "skill:skills-sh:foo/bar@my-skill");
    expect(pin?.source_sha).toBe("sha1");
    expect(pin?.pinned_by).toBe("auto-trusted");
    const hist = getHistory(db, "skill:skills-sh:foo/bar@my-skill");
    expect(hist.length).toBe(1);
    expect(hist[0].installed_by).toBe("auto-trusted");
    db.close();
  });

  test("untrusted install refused without --yes", async () => {
    writeTrust([]);  // empty allowlist
    const report = await runInstall({
      dbPath, trustPath,
      capabilityId: "skill:skills-sh:stranger/repo@x",
      yes: false, yesDrift: false, transportArgs: [],
      installerImpls: { skillsSh: stubInstaller("sha1") },
    });
    expect(report.trust_action).toBe("refused-untrusted");
    expect(report.outcome.status).toBe("failed");
    expect(report.outcome.errors[0]).toContain("Untrusted");
  });

  test("untrusted install with --yes writes user-confirm pin + promote suggestion", async () => {
    writeTrust([]);
    const report = await runInstall({
      dbPath, trustPath,
      capabilityId: "skill:skills-sh:stranger/repo@x",
      yes: true, yesDrift: false, transportArgs: [],
      installerImpls: { skillsSh: stubInstaller("shaY") },
    });
    expect(report.trust_action).toBe("user-confirm");
    expect(report.promote_suggestion).toContain("stranger");

    const db = openDb(dbPath); migrate(db);
    const pin = getPin(db, "skill:skills-sh:stranger/repo@x");
    expect(pin?.pinned_by).toBe("user-confirm");
    db.close();
  });

  test("unsupported kind (skill:raw) returns failed outcome with v0.2 marker", async () => {
    writeTrust([]);
    const report = await runInstall({
      dbPath, trustPath,
      capabilityId: "skill:raw:https://example.com/foo.md:slug",
      yes: false, yesDrift: false, transportArgs: [],
    });
    expect(report.outcome.status).toBe("failed");
    expect(report.outcome.errors[0]).toContain("v0.2");
  });

  test("already-installed capability returns skipped", async () => {
    const db = openDb(dbPath); migrate(db);
    const rec: CapabilityRecord = {
      id: "skill:skills-sh:foo/bar@x",
      source_type: "skill",
      name: "x", canonical_name: "foo/bar@x", description: null, keywords: null,
      installed: 1, enabled: null, bundle_id: null, bundle_version: null, bundle_path: null,
      source_url: null, source_sha: null, last_seen_epoch: 1, content_hash: "h",
    };
    applyRecords(db, [rec]);
    db.close();

    writeTrust(["foo/*"]);
    const report = await runInstall({
      dbPath, trustPath,
      capabilityId: "skill:skills-sh:foo/bar@x",
      yes: false, yesDrift: false, transportArgs: [],
      installerImpls: { skillsSh: stubInstaller("nope") },  // should not be called
    });
    expect(report.outcome.status).toBe("skipped");
    expect(report.outcome.errors[0]).toBe("already installed");
  });

  test("brew-cli returns skipped print-only outcome (no history row)", async () => {
    const report = await runInstall({
      dbPath, trustPath,
      capabilityId: "cli:brew:jq",
      yes: false, yesDrift: false, transportArgs: [],
    });
    expect(report.outcome.status).toBe("skipped");
    expect(report.outcome.errors[0]).toContain("brew install jq");

    const db = openDb(dbPath); migrate(db);
    expect(getHistory(db, "cli:brew:jq")).toEqual([]);
    db.close();
  });

  test("drift detected on existing pin refuses without --yes-drift", async () => {
    writeTrust(["foo/*"]);
    // Seed a pin at a known sha.
    const db = openDb(dbPath); migrate(db);
    const { writePin } = await import("../../src/trust/pins");
    writePin(db, {
      capability_id: "skill:skills-sh:foo/bar@x",
      source_sha: "old-sha",
      pinned_by: "auto-trusted",
      source_url: "https://github.com/foo/bar",
    });
    db.close();

    const report = await runInstall({
      dbPath, trustPath,
      capabilityId: "skill:skills-sh:foo/bar@x",
      yes: false, yesDrift: false, transportArgs: [],
      installerImpls: { skillsSh: stubInstaller("new-sha") },
    });
    expect(report.trust_action).toBe("refused-drift");
    expect(report.outcome.errors.join("\n")).toContain("drift");
  });

  test("mcp install without --yes is refused (defaults to unknown trust)", async () => {
    const report = await runInstall({
      dbPath, trustPath,
      capabilityId: "mcp:my-server",
      yes: false, yesDrift: false, transportArgs: ["npx", "-y", "@org/srv"],
    });
    expect(report.trust_action).toBe("refused-untrusted");
    expect(report.outcome.status).toBe("failed");
    expect(report.outcome.errors[0]).toContain("--yes");
  });

  test("mcp install with --yes but no transport args fails with helpful error", async () => {
    const report = await runInstall({
      dbPath, trustPath,
      capabilityId: "mcp:my-server",
      yes: true, yesDrift: false, transportArgs: [],
    });
    expect(report.outcome.status).toBe("failed");
    expect(report.outcome.errors[0]).toContain("--transport-arg");
  });

  test("mcp install with --yes + transport args writes history and reports user-confirm", async () => {
    const report = await runInstall({
      dbPath, trustPath,
      capabilityId: "mcp:my-server",
      yes: true, yesDrift: false, transportArgs: ["npx", "-y", "@org/srv"],
      installerImpls: {
        mcp: async (ctx) => ({
          capability_id: ctx.capability_id,
          status: "installed",
          source_sha: null,
          verified: true,
          files: [],
          errors: [],
        }),
      },
    });
    expect(report.outcome.status).toBe("installed");
    expect(report.trust_action).toBe("user-confirm");

    const db = openDb(dbPath); migrate(db);
    const hist = getHistory(db, "mcp:my-server");
    expect(hist.length).toBe(1);
    expect(hist[0].installed_by).toBe("user-confirm");
    expect(hist[0].source_sha).toBe("n/a");
    db.close();
  });

  test("drift accepted with --yes-drift updates pin and writes history", async () => {
    writeTrust(["foo/*"]);
    const db = openDb(dbPath); migrate(db);
    const { writePin } = await import("../../src/trust/pins");
    writePin(db, {
      capability_id: "skill:skills-sh:foo/bar@x",
      source_sha: "old-sha",
      pinned_by: "auto-trusted",
      source_url: "https://github.com/foo/bar",
    });
    db.close();

    const report = await runInstall({
      dbPath, trustPath,
      capabilityId: "skill:skills-sh:foo/bar@x",
      yes: false, yesDrift: true, transportArgs: [],
      installerImpls: { skillsSh: stubInstaller("new-sha") },
    });
    expect(report.trust_action).toBe("auto-trusted");

    const db2 = openDb(dbPath); migrate(db2);
    expect(getPin(db2, "skill:skills-sh:foo/bar@x")?.source_sha).toBe("new-sha");
    expect(getHistory(db2, "skill:skills-sh:foo/bar@x").length).toBe(1);
    db2.close();
  });
});
