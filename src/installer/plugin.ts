import { $ } from "bun";
import { readFileSync } from "node:fs";
import { paths } from "../paths.ts";
import { runInstaller, InstallFailed } from "./run.ts";
import type { InstallContext, InstallOutcome } from "./types.ts";

export function installPlugin(ctx: InstallContext): Promise<InstallOutcome> {
  return runInstaller(ctx, async (c) => {
    const proc = await $`claude plugin install ${c.canonical_name}`.quiet().nothrow();
    if (proc.exitCode !== 0) throw new InstallFailed(proc.stderr.toString());

    const manifest = JSON.parse(readFileSync(paths.claudePluginsManifest, "utf8"));
    const entry = manifest.plugins?.[c.canonical_name]?.[0];
    if (!entry) throw new InstallFailed("Plugin manifest entry not found after install");

    return {
      status: "installed",
      source_sha: entry.gitCommitSha ?? null,
      files: [entry.installPath],
      verified: true,
    };
  });
}
