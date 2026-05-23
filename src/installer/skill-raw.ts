import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { paths } from "../paths.ts";
import { parseFrontmatter } from "../inventory/description.ts";
import { runInstaller, InstallFailed } from "./run.ts";
import type { InstallContext, InstallOutcome } from "./types.ts";

export interface RawSkillArgs extends InstallContext {
  raw_url: string;
  skill_slug: string;
}

export function installSkillRaw(args: RawSkillArgs): Promise<InstallOutcome> {
  return runInstaller(args, async (a) => {
    const resp = await fetch(a.raw_url);
    if (!resp.ok) throw new InstallFailed(`HTTP ${resp.status}`);
    const text = await resp.text();

    // Positive validation via the canonical SKILL.md parser. Rejects HTML
    // error pages, JSON 404 bodies, binary content, plain-text errors — any
    // response that doesn't open with parseable YAML frontmatter + `name:`.
    const { fm } = parseFrontmatter(text);
    if (!fm.name) {
      throw new InstallFailed("Response is not a valid SKILL.md (missing 'name' in YAML frontmatter)");
    }

    const dir = `${paths.claudeSkills}/${a.skill_slug}`;
    mkdirSync(dir, { recursive: true });
    const file = `${dir}/SKILL.md`;
    writeFileSync(file, text);

    return {
      status: "installed",
      source_sha: createHash("sha1").update(text).digest("hex").slice(0, 12),
      files: [file],
      verified: true,
    };
  });
}
