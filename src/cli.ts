#!/usr/bin/env bun
import { paths } from "./paths.ts";
import { type SourceType, SOURCE_TYPES, isSourceType } from "./inventory/types.ts";
import type { SurveyResult } from "./commands/survey.ts";

const [, , sub, ...rest] = process.argv;

async function main() {
  switch (sub) {
    case "init": {
      const { runInit } = await import("./commands/init.ts");
      const flags = new Set(rest);
      const args = {
        dataDir: paths.dataDir,
        claudeDir: paths.claudeDir,
        claudeJson: paths.claudeJson,
        mcpServers: await loadMcpServers(),
        mcpFetcher: mcpFetcher(),
        force: flags.has("--force"),
        check: flags.has("--check"),
        refreshMcp: flags.has("--refresh-mcp"),
        enabledPlugins: await loadEnabledPlugins(),
      };
      const r = await runInit(args);
      console.log(`[quartermaster] init: ${JSON.stringify(r.counts)}`);
      if (r.problems.length) console.warn(r.problems.join("\n"));
      break;
    }
    case "survey": {
      const goal = rest.join(" ");
      if (!goal) { console.error("usage: /qm survey <goal>"); process.exit(2); }
      const { runSurvey } = await import("./commands/survey.ts");
      const { rerank } = await import("./matcher/rerank.ts");
      const result = await runSurvey({
        dataDir: paths.dataDir,
        dbPath: paths.inventoryDb,
        goal,
        rerankImpl: rerank,
      });
      if (result.refused) {
        console.error("[quartermaster] no inventory. Run /qm init first.");
        process.exit(2);
      }
      printSurvey(result);
      break;
    }
    case "list": {
      const { runList } = await import("./commands/list.ts");
      const raw = rest.find(a => a.startsWith("--source-type="))?.split("=")[1];
      let filter: SourceType | undefined;
      if (raw !== undefined) {
        if (!isSourceType(raw)) {
          console.error(`unknown --source-type=${raw}; expected one of ${SOURCE_TYPES.join("|")}`);
          process.exit(2);
        }
        filter = raw;
      }
      for (const r of runList(paths.inventoryDb, filter)) {
        console.log(`${r.source_type.padEnd(10)} ${r.canonical_name.padEnd(40)} ${r.description?.slice(0, 60) ?? ""}`);
      }
      break;
    }
    case "trust": {
      const action = rest[0];
      const { runTrustAdd, runTrustList } = await import("./commands/trust.ts");
      if (action === "add") runTrustAdd(paths.trustJson, rest[1]);
      else if (action === "list") console.log(JSON.stringify(runTrustList(paths.trustJson), null, 2));
      else { console.error("usage: /qm trust add <pattern> | list"); process.exit(2); }
      break;
    }
    case "prune": {
      const { runPrune } = await import("./commands/prune.ts");
      console.log(`[quartermaster] pruned ${runPrune(paths.inventoryDb)} rows`);
      break;
    }
    default:
      console.error("usage: /qm init|survey|list|trust|prune");
      process.exit(2);
  }
}

async function loadMcpServers(): Promise<Record<string, unknown>> {
  try {
    const j = JSON.parse(await Bun.file(paths.claudeJson).text());
    return j.mcpServers ?? {};
  } catch { return {}; }
}

async function loadEnabledPlugins(): Promise<Set<string>> {
  try {
    const j = JSON.parse(await Bun.file(paths.claudeSettings).text());
    return new Set(
      Object.entries(j.enabledPlugins ?? {})
        .filter(([, v]) => v === true)
        .map(([k]) => k),
    );
  } catch { return new Set(); }
}

function mcpFetcher() {
  return async (_name: string, _cfg: unknown) => [];  // v1 stub; real impl needs MCP client wiring
}

function printSurvey(r: SurveyResult): void {
  console.log("INSTALLED (use now):");
  for (const row of r.installed) {
    console.log(`  ${row.name} (${row.source_type}) — ${row.description?.slice(0, 80) ?? ""}`);
  }
  console.log("\nGAP CANDIDATES:");
  for (const row of r.gap) {
    console.log(`  ${row.name} (${row.source_type}, ${row.trust_level}) — ${row.description?.slice(0, 80) ?? ""}`);
  }
  if (r.degraded) console.log("\n⚠ matching degraded (no semantic rerank)");
}

main();
