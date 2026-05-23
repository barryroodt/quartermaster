import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { paths } from "../paths.ts";
import type { InstallContext, InstallResult } from "./types.ts";

export interface RawSkillArgs extends InstallContext {
  raw_url: string;
  skill_slug: string;
}

export async function installSkillRaw(args: RawSkillArgs): Promise<InstallResult> {
  const result: InstallResult = {
    capability_id: args.capability_id, status: "failed", source_sha: null, trust_action: "none",
    verified: false, files: [], errors: [],
  };
  try {
    const resp = await fetch(args.raw_url);
    if (!resp.ok) { result.errors.push(`HTTP ${resp.status}`); return result; }
    const text = await resp.text();
    if (text.trim().startsWith("<")) { result.errors.push("Response looks like HTML, not raw markdown"); return result; }
    const dir = `${paths.claudeSkills}/${args.skill_slug}`;
    mkdirSync(dir, { recursive: true });
    const file = `${dir}/SKILL.md`;
    writeFileSync(file, text);
    result.source_sha = createHash("sha1").update(text).digest("hex").slice(0, 12);
    result.files = [file];
    result.status = "installed";
    result.verified = true;
  } catch (e) {
    result.errors.push(String(e));
  }
  return result;
}
