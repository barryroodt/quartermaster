import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../db/connection.ts";
import { migrate } from "../db/migrate.ts";
import { applyRecords } from "../inventory/indexer.ts";
import { enumerateSkills } from "../inventory/enum-skills.ts";
import { enumeratePlugins } from "../inventory/enum-plugins.ts";
import { enumerateMdTree } from "../inventory/enum-md-tree.ts";
import { enumerateMcp, type ToolsListFetcher } from "../inventory/enum-mcp.ts";
import { enumerateCli, type CliKnown } from "../inventory/enum-cli.ts";
import { seedDefault } from "../trust/derive.ts";
import { signatureHash, defaultSignatureInputs } from "../inventory/hash.ts";
import CLI_KNOWN from "../inventory/cli-known.json" with { type: "json" };

export interface InitArgs {
  dataDir: string;
  claudeDir: string;
  claudeJson: string;
  mcpServers: Record<string, unknown>;
  mcpFetcher: ToolsListFetcher;
  force?: boolean;
  check?: boolean;
  refreshMcp?: boolean;
  enabledPlugins?: Set<string>;
}

export interface InitResult { ok: boolean; counts: Record<string, number>; problems: string[] }

export async function runInit(args: InitArgs): Promise<InitResult> {
  const problems: string[] = [];
  mkdirSync(args.dataDir, { recursive: true });
  const trustPath = join(args.dataDir, "trust.json");
  const dbPath = join(args.dataDir, "inventory.db");
  const hashPath = join(args.dataDir, "inventory.hash");

  if (args.force && existsSync(dbPath)) rmSync(dbPath);

  const enabled = args.enabledPlugins ?? new Set<string>();
  const syncRecords = [
    ...enumerateSkills(join(args.claudeDir, "skills")),
    ...enumeratePlugins(join(args.claudeDir, "plugins/installed_plugins.json"), enabled),
    ...enumerateMdTree(join(args.claudeDir, "commands"), "command"),
    ...enumerateMdTree(join(args.claudeDir, "agents"), "agent"),
    ...enumerateCli(CLI_KNOWN as Record<string, CliKnown>, loadCliExtras(args.dataDir)),
  ];

  if (args.check) {
    const counts = countBySource(syncRecords);
    return { ok: true, counts, problems };
  }

  seedDefault(trustPath);
  const db = openDb(dbPath);
  migrate(db);
  if (args.refreshMcp) db.exec("DELETE FROM mcp_tool_cache");
  const mcpRecords = await enumerateMcp(args.mcpServers, db, args.mcpFetcher);
  const records = [...syncRecords, ...mcpRecords];
  applyRecords(db, records);
  db.close();

  writeFileSync(hashPath, signatureHash(defaultSignatureInputs()));
  return { ok: true, counts: countBySource(records), problems };
}

function loadCliExtras(dataDir: string): Record<string, CliKnown> {
  const path = join(dataDir, "cli-extras.json");
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf8")) as Record<string, CliKnown>; } catch { console.warn("[quartermaster] cli-extras.json malformed; ignoring"); return {}; }
}

function countBySource(records: { source_type: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of records) counts[r.source_type] = (counts[r.source_type] ?? 0) + 1;
  return counts;
}
