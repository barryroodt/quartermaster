import { $ } from "bun";
import { readFileSync } from "node:fs";
import { paths } from "../paths.ts";
import type { InstallContext, InstallResult } from "./types.ts";

export async function installPlugin(ctx: InstallContext): Promise<InstallResult> {
  const result: InstallResult = {
    capability_id: ctx.capability_id, status: "failed", source_sha: null, trust_action: "none",
    verified: false, files: [], errors: [],
  };
  try {
    const proc = await $`claude plugin install ${ctx.canonical_name}`.quiet().nothrow();
    if (proc.exitCode !== 0) {
      result.errors.push(proc.stderr.toString());
      return result;
    }
    const manifest = JSON.parse(readFileSync(paths.claudePluginsManifest, "utf8"));
    const entries = manifest.plugins?.[ctx.canonical_name];
    if (entries?.[0]) {
      result.source_sha = entries[0].gitCommitSha ?? null;
      result.files = [entries[0].installPath];
      result.status = "installed";
      result.verified = true;
    } else {
      result.errors.push("Plugin manifest entry not found after install");
    }
  } catch (e) {
    result.errors.push(String(e));
  }
  return result;
}
