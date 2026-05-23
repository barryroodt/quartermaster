import { openDb } from "../db/connection.ts";
import { migrate } from "../db/migrate.ts";
import { loadTrust, trustLevel } from "../trust/derive.ts";
import { getPin, writePin, driftCheck } from "../trust/pins.ts";
import { writeHistory } from "../installer/history.ts";
import { installSkillSkillsSh } from "../installer/skill-skillssh.ts";
import { installPlugin } from "../installer/plugin.ts";
import { installCli } from "../installer/cli.ts";
import { installSkillRaw } from "../installer/skill-raw.ts";
import { installMcp } from "../installer/mcp.ts";
import { formatUntrustedPrompt, formatDriftPrompt, formatPromotePrompt } from "../installer/prompts.ts";
import type { InstallContext, InstallOutcome } from "../installer/types.ts";

export type ParsedId =
  | { kind: "skills-sh"; canonical: string; owner: string; repo: string; url: string }
  | { kind: "raw-skill"; url: string; slug: string }
  | { kind: "plugin"; canonical: string; owner: string; repo: string; url: string }
  | { kind: "mcp"; name: string }
  | { kind: "brew-cli"; name: string }
  | { kind: "unsupported"; reason: string };

// Capability id grammar (from spec §5):
//   skill:skills-sh:<owner>/<repo>@<slug>
//   skill:raw:<url>:<slug>
//   plugin:claude:<owner>/<repo>
//   mcp:<name>
//   cli:brew:<name>
export function parseCapabilityId(id: string): ParsedId {
  if (id.startsWith("skill:skills-sh:")) {
    const canonical = id.slice("skill:skills-sh:".length);
    const m = canonical.match(/^([^/]+)\/([^@]+)@(.+)$/);
    if (!m) return { kind: "unsupported", reason: `malformed skills.sh canonical: ${canonical}` };
    return {
      kind: "skills-sh",
      canonical,
      owner: m[1],
      repo: m[2],
      url: `https://github.com/${m[1]}/${m[2]}`,
    };
  }
  if (id.startsWith("skill:raw:")) {
    // Best-effort split: <url>:<slug>. URLs contain colons, so split from the right.
    const tail = id.slice("skill:raw:".length);
    const lastColon = tail.lastIndexOf(":");
    if (lastColon === -1) return { kind: "unsupported", reason: `malformed skill:raw id: ${id}` };
    return { kind: "raw-skill", url: tail.slice(0, lastColon), slug: tail.slice(lastColon + 1) };
  }
  if (id.startsWith("plugin:claude:")) {
    const canonical = id.slice("plugin:claude:".length);
    const m = canonical.match(/^([^/]+)\/(.+)$/);
    if (!m) return { kind: "unsupported", reason: `malformed plugin canonical: ${canonical}` };
    return {
      kind: "plugin",
      canonical,
      owner: m[1],
      repo: m[2],
      url: `https://github.com/${m[1]}/${m[2]}`,
    };
  }
  if (id.startsWith("mcp:")) {
    return { kind: "mcp", name: id.slice("mcp:".length) };
  }
  if (id.startsWith("cli:brew:")) {
    return { kind: "brew-cli", name: id.slice("cli:brew:".length) };
  }
  return { kind: "unsupported", reason: `unrecognized capability_id shape: ${id}` };
}

export type InstallerFn = (ctx: InstallContext & Record<string, unknown>) => Promise<InstallOutcome>;

export interface InstallerImpls {
  skillsSh?: (ctx: InstallContext) => Promise<InstallOutcome>;
  plugin?: (ctx: InstallContext) => Promise<InstallOutcome>;
  brewCli?: (ctx: InstallContext & { command: string }) => Promise<InstallOutcome>;
}

export interface InstallArgs {
  dbPath: string;
  trustPath: string;
  capabilityId: string;
  yes: boolean;
  yesDrift: boolean;
  transportArgs: string[];
  // DI hook for tests — production paths use the real installers.
  installerImpls?: InstallerImpls;
}

export type TrustAction =
  | "auto-trusted"
  | "user-confirm"
  | "refused-untrusted"
  | "refused-drift"
  | "none";

export interface InstallReport {
  outcome: InstallOutcome;
  trust_action: TrustAction;
  promote_suggestion?: string;
}

function unsupportedOutcome(id: string, reason: string): InstallReport {
  return {
    outcome: {
      capability_id: id,
      status: "failed",
      source_sha: null,
      verified: false,
      files: [],
      errors: [reason],
    },
    trust_action: "none",
  };
}

export async function runInstall(args: InstallArgs): Promise<InstallReport> {
  const parsed = parseCapabilityId(args.capabilityId);

  // v0.2 deferred shapes — keep modules wired but dispatcher returns failed.
  if (parsed.kind === "raw-skill") {
    return unsupportedOutcome(args.capabilityId, "v0.2: skill:raw install not yet wired in CLI dispatcher");
  }
  if (parsed.kind === "mcp") {
    return unsupportedOutcome(args.capabilityId, "v0.2: mcp:* install not yet wired in CLI dispatcher");
  }
  if (parsed.kind === "unsupported") {
    return unsupportedOutcome(args.capabilityId, parsed.reason);
  }

  const db = openDb(args.dbPath);
  migrate(db);
  try {
    // Pre-installed lookup — if the inventory already marks it installed, no-op.
    const existing = db
      .query("SELECT installed FROM capabilities WHERE id = ?")
      .get(args.capabilityId) as { installed: number } | null;
    if (existing && existing.installed === 1) {
      return {
        outcome: {
          capability_id: args.capabilityId,
          status: "skipped",
          source_sha: null,
          verified: false,
          files: [],
          errors: ["already installed"],
        },
        trust_action: "none",
      };
    }

    // brew CLI: no source_url → trust check skipped; print-only outcome; no history row.
    if (parsed.kind === "brew-cli") {
      const impl = args.installerImpls?.brewCli ?? installCli;
      const outcome = await impl({
        capability_id: args.capabilityId,
        canonical_name: parsed.name,
        source_type: "cli",
        command: `brew install ${parsed.name}`,
      });
      return { outcome, trust_action: "none" };
    }

    // skills.sh + plugin: same trust flow (both ultimately github owner/repo).
    const trustCfg = loadTrust(args.trustPath);
    const sourceUrl = parsed.url;
    const level = trustLevel(sourceUrl, trustCfg);

    if (level === "blocked") {
      return {
        outcome: {
          capability_id: args.capabilityId,
          status: "blocked",
          source_sha: null,
          verified: false,
          files: [],
          errors: [`source ${sourceUrl} is in blocked_patterns`],
        },
        trust_action: "none",
      };
    }

    if (level === "unknown" && !args.yes) {
      const prompt = formatUntrustedPrompt({
        canonical: parsed.canonical,
        source_url: sourceUrl,
        source_sha: "(unknown — install will fetch)",
      });
      return {
        outcome: {
          capability_id: args.capabilityId,
          status: "failed",
          source_sha: null,
          verified: false,
          files: [],
          errors: [prompt],
        },
        trust_action: "refused-untrusted",
      };
    }

    // Run the installer.
    const ctx: InstallContext = {
      capability_id: args.capabilityId,
      canonical_name: parsed.canonical,
      source_type: parsed.kind === "skills-sh" ? "skill" : "plugin",
      source_url: sourceUrl,
      registry: parsed.kind === "skills-sh" ? "skills.sh" : "claude-marketplace",
    };
    const installer =
      parsed.kind === "skills-sh"
        ? (args.installerImpls?.skillsSh ?? installSkillSkillsSh)
        : (args.installerImpls?.plugin ?? installPlugin);
    const outcome = await installer(ctx);

    if (outcome.status !== "installed") {
      return { outcome, trust_action: "none" };
    }

    // Post-install: pin + drift + history.
    const sha = outcome.source_sha ?? "";
    const existingPin = getPin(db, args.capabilityId);

    // Drift = existing pin with mismatching SHA (only meaningful when trusted).
    if (existingPin && sha && existingPin.source_sha !== sha && !args.yesDrift) {
      const prompt = formatDriftPrompt({
        canonical: parsed.canonical,
        pinned_sha: existingPin.source_sha,
        current_sha: sha,
        source_url: sourceUrl,
      });
      return {
        outcome: {
          ...outcome,
          errors: [...outcome.errors, prompt],
        },
        trust_action: "refused-drift",
      };
    }

    // Write/update pin + history.
    const pinnedBy: "auto-trusted" | "user-confirm" = level === "trusted" ? "auto-trusted" : "user-confirm";
    if (sha) {
      writePin(db, {
        capability_id: args.capabilityId,
        source_sha: sha,
        pinned_by: pinnedBy,
        source_url: sourceUrl,
      });
      writeHistory(db, {
        capability_id: args.capabilityId,
        source_sha: sha,
        installed_by: pinnedBy,
      });
    }

    // Drift check post-write (mostly informational; we already gated drift above).
    void driftCheck(db, args.capabilityId, sha);

    const report: InstallReport = {
      outcome,
      trust_action: level === "trusted" ? "auto-trusted" : "user-confirm",
    };
    if (level === "unknown") {
      report.promote_suggestion = formatPromotePrompt({ owner: parsed.owner, repo: parsed.repo });
    }
    return report;
  } finally {
    db.close();
  }
}
