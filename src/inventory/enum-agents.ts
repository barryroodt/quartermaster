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

export function enumerateAgents(root: string, opts: EnumOpts = {}): CapabilityRecord[] {
  return walkMd(root).map((path) => {
    const content = readFileSync(path, "utf8");
    const name = basename(path, ".md");
    const description = extractFromMarkdown(content);
    const canonical = opts.pluginSlug ? `${opts.pluginSlug}:${name}` : name;
    return buildRecord({
      id: `agent:${canonical}`,
      source_type: "agent",
      name,
      canonical_name: canonical,
      description,
      bundle_id: opts.pluginSlug ?? null,
      bundle_path: path,
      last_seen_epoch: Math.floor(Date.now() / 1000),
      content_hash: contentHash(description, null),
    });
  });
}
