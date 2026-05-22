import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractFromJson } from "./description.ts";
import { contentHash, type CapabilityRecord } from "./types.ts";

interface PluginEntry {
  scope: string;
  installPath: string;
  version: string;
  gitCommitSha?: string;
}

interface Manifest {
  version: number;
  plugins: Record<string, PluginEntry[]>;
}

export function enumeratePlugins(manifestPath: string, enabled: Set<string>): CapabilityRecord[] {
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return [];
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: CapabilityRecord[] = [];
  for (const [pluginId, entries] of Object.entries(manifest.plugins ?? {})) {
    const entry = entries[0];
    if (!entry) continue;
    let description: string | null = null;
    try {
      const pj = readFileSync(join(entry.installPath, ".claude-plugin", "plugin.json"), "utf8");
      description = extractFromJson(pj);
    } catch {}
    const name = pluginId.split("@")[0];
    out.push({
      id: `plugin:${pluginId}`,
      source_type: "plugin",
      name,
      canonical_name: pluginId,
      description,
      keywords: null,
      installed: 1,
      enabled: enabled.has(pluginId) ? 1 : 0,
      bundle_id: pluginId,
      bundle_version: entry.version,
      bundle_path: entry.installPath,
      source_url: null,
      source_sha: entry.gitCommitSha ?? null,
      last_seen_epoch: Math.floor(Date.now() / 1000),
      content_hash: contentHash(description, null),
    });
  }
  return out;
}
