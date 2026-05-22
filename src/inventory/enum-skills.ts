import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractFromMarkdown, parseFrontmatter } from "./description.ts";
import { contentHash } from "./hash.ts";
import { type CapabilityRecord } from "./types.ts";

export interface EnumOpts {
  pluginSlug?: string;
}

export function enumerateSkills(root: string, opts: EnumOpts = {}): CapabilityRecord[] {
  const out: CapabilityRecord[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const skillPath = join(root, entry, "SKILL.md");
    let content: string;
    try {
      content = readFileSync(skillPath, "utf8");
    } catch {
      continue;
    }
    const name = parseFrontmatter(content).fm.name ?? entry;
    const description = extractFromMarkdown(content);
    const canonical = opts.pluginSlug ? `${opts.pluginSlug}:${name}` : name;
    out.push({
      id: `skill:${canonical}`,
      source_type: "skill",
      name,
      canonical_name: canonical,
      description,
      keywords: null,
      installed: 1,
      enabled: null,
      bundle_id: opts.pluginSlug ?? null,
      bundle_version: null,
      bundle_path: join(root, entry),
      source_url: null,
      source_sha: null,
      last_seen_epoch: Math.floor(Date.now() / 1000),
      content_hash: contentHash(description, null),
    });
  }
  return out;
}
