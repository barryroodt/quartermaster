import { $ } from "bun";
import { existsSync } from "node:fs";
import { paths } from "../paths.ts";
import { runInstaller, InstallFailed } from "./run.ts";
import type { InstallContext, InstallOutcome } from "./types.ts";

export function installSkillSkillsSh(ctx: InstallContext): Promise<InstallOutcome> {
  return runInstaller(ctx, async (c) => {
    const proc = await $`npx -y skills add -y -g ${c.canonical_name}`.quiet().nothrow();
    if (proc.exitCode !== 0) throw new InstallFailed(proc.stderr.toString());

    const slug = c.canonical_name.split("/").pop()!;
    const skillDir = `${paths.claudeSkills}/${slug}`;
    if (!existsSync(`${skillDir}/SKILL.md`)) {
      throw new InstallFailed("SKILL.md not found after npx skills add (silent no-op)");
    }

    // No SHA = no trust pin = downstream pin write would crash. Fail loudly
    // rather than return a "success" the orchestrator can't act on.
    const sha = await $`git -C ${skillDir} rev-parse HEAD`.quiet().nothrow();
    if (sha.exitCode !== 0) {
      throw new InstallFailed(`git rev-parse failed in ${skillDir}; cannot determine source SHA for trust pin`);
    }

    return {
      status: "installed",
      source_sha: sha.stdout.toString().trim(),
      files: [`${skillDir}/SKILL.md`],
      verified: true,
    };
  });
}
