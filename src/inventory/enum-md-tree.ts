import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { extractFromMarkdown } from "./description.ts";
import { contentHash } from "./hash.ts";
import { buildRecord, type CapabilityRecord } from "./types.ts";

export interface EnumOpts {
  pluginSlug?: string;
}

function walkMd(root: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(root, e);
    let s;
    try {
      s = lstatSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) walkMd(p, out);
    else if (extname(e) === ".md") out.push(p);
  }
  return out;
}

const SEPARATOR: Record<"command" | "agent", string> = {
  command: "/",
  agent: ":",
};

export function enumerateMdTree(
  root: string,
  sourceType: "command" | "agent",
  opts: EnumOpts = {},
): CapabilityRecord[] {
  const now = Math.floor(Date.now() / 1000);
  const sep = SEPARATOR[sourceType];
  const out: CapabilityRecord[] = [];
  for (const path of walkMd(root)) {
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const name = basename(path, ".md");
    const description = extractFromMarkdown(content);
    const canonical = opts.pluginSlug ? `${opts.pluginSlug}${sep}${name}` : name;
    out.push(buildRecord({
      id: `${sourceType}:${canonical}`,
      source_type: sourceType,
      name,
      canonical_name: canonical,
      description,
      bundle_id: opts.pluginSlug ?? null,
      bundle_path: path,
      last_seen_epoch: now,
      content_hash: contentHash(description, null),
    }));
  }
  return out;
}
