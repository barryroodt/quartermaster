#!/usr/bin/env bun
import { paths } from "./paths.ts";
import { type SourceType, SOURCE_TYPES, isSourceType } from "./inventory/types.ts";
import { printSurvey, printCapability } from "./matcher/format.ts";
import { loadJsonOrAsync } from "./util/json.ts";
import { runInit } from "./commands/init.ts";
import { runSurvey } from "./commands/survey.ts";
import { runList } from "./commands/list.ts";
import { runTrustAdd, runTrustList } from "./commands/trust.ts";
import { runPrune } from "./commands/prune.ts";
import { runInstall } from "./commands/install.ts";
import { rerank } from "./matcher/rerank.ts";

const [, , sub, ...rest] = process.argv;

async function main() {
  switch (sub) {
    case "init": {
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
      if (Object.keys(args.mcpServers).length > 0) {
        console.warn("[quartermaster] mcp_server indexing active; mcp_tool enumeration deferred to ToolSearch (spec §22)");
      }
      const r = await runInit(args);
      console.log(`[quartermaster] init: ${JSON.stringify(r.counts)}`);
      if (r.problems.length) console.warn(r.problems.join("\n"));
      break;
    }
    case "survey": {
      const goal = rest.join(" ");
      if (!goal) { console.error("usage: /qm survey <goal>"); process.exit(2); }
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
        printCapability(r);
      }
      break;
    }
    case "trust": {
      const action = rest[0];
      if (action === "add") {
        if (!rest[1]) { console.error("usage: /qm trust add <pattern>"); process.exit(2); }
        runTrustAdd(paths.trustJson, rest[1]);
      }
      else if (action === "list") console.log(JSON.stringify(runTrustList(paths.trustJson), null, 2));
      else { console.error("usage: /qm trust add <pattern> | list"); process.exit(2); }
      break;
    }
    case "prune": {
      console.log(`[quartermaster] pruned ${runPrune(paths.inventoryDb)} rows`);
      break;
    }
    case "install": {
      const id = rest[0];
      if (!id) {
        console.error("usage: /qm install <capability_id> [--yes] [--yes-drift] [--transport-arg=<arg>]...");
        process.exit(2);
      }
      const flags = new Set(rest);
      const transportArgs = rest
        .filter(a => a.startsWith("--transport-arg="))
        .map(a => a.split("=").slice(1).join("="));
      const report = await runInstall({
        dbPath: paths.inventoryDb,
        trustPath: paths.trustJson,
        capabilityId: id,
        yes: flags.has("--yes"),
        yesDrift: flags.has("--yes-drift"),
        transportArgs,
      });
      const { outcome } = report;
      console.log(`[quartermaster] install ${outcome.status}: ${outcome.capability_id}`);
      if (outcome.errors.length) console.error(outcome.errors.join("\n"));
      if (report.trust_action === "refused-untrusted") {
        console.error("\nRe-run with --yes to install from untrusted source.");
        process.exit(3);
      }
      if (report.trust_action === "refused-drift") {
        console.error("\nRe-run with --yes-drift to accept pin drift.");
        process.exit(3);
      }
      if (report.promote_suggestion) console.log("\n" + report.promote_suggestion);
      break;
    }
    default:
      console.error("usage: /qm init|survey|install|list|trust|prune");
      process.exit(2);
  }
}

async function loadMcpServers(): Promise<Record<string, unknown>> {
  const j = await loadJsonOrAsync<{ mcpServers?: Record<string, unknown> }>(paths.claudeJson, {});
  return j.mcpServers ?? {};
}

async function loadEnabledPlugins(): Promise<Set<string>> {
  const j = await loadJsonOrAsync<{ enabledPlugins?: Record<string, boolean> }>(paths.claudeSettings, {});
  return new Set(
    Object.entries(j.enabledPlugins ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k),
  );
}

function mcpFetcher() {
  return async (_name: string, _cfg: unknown) => [];  // v1 stub; real impl needs MCP client wiring
}

main();
