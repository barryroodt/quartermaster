import { $ } from "bun";
import { existsSync } from "node:fs";
import { paths } from "../paths.ts";
import type { InstallContext, InstallResult } from "./types.ts";

export async function installSkillSkillsSh(ctx: InstallContext): Promise<InstallResult> {
  const result: InstallResult = {
    capability_id: ctx.capability_id, status: "failed", source_sha: null, trust_action: "none",
    verified: false, files: [], errors: [],
  };
  try {
    const proc = await $`npx -y skills add -y -g ${ctx.canonical_name}`.quiet().nothrow();
    if (proc.exitCode !== 0) {
      result.errors.push(proc.stderr.toString());
      return result;
    }
    const slug = ctx.canonical_name.split("/").pop()!;
    const skillDir = `${paths.claudeSkills}/${slug}`;
    if (!existsSync(`${skillDir}/SKILL.md`)) {
      result.errors.push("SKILL.md not found after npx skills add (silent no-op)");
      return result;
    }
    const sha = await $`git -C ${skillDir} rev-parse HEAD`.quiet().nothrow();
    result.source_sha = sha.exitCode === 0 ? sha.stdout.toString().trim() : null;
    result.files = [`${skillDir}/SKILL.md`];
    result.status = "installed";
    result.verified = true;
  } catch (e) {
    result.errors.push(String(e));
  }
  return result;
}
