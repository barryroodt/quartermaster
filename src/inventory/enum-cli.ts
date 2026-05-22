import { contentHash } from "./hash.ts";
import { buildRecord, type CapabilityRecord } from "./types.ts";
import { which } from "../util/which.ts";

export interface CliKnown {
  description: string;
  registry: "brew" | "npm" | "cargo" | "system";
}

export function enumerateCli(
  known: Record<string, CliKnown>,
  extras: Record<string, CliKnown>,
): CapabilityRecord[] {
  const merged = { ...known, ...extras };
  const out: CapabilityRecord[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (const [bin, meta] of Object.entries(merged)) {
    const path = which(bin);
    if (!path) continue;
    out.push(buildRecord({
      id: `cli:bin:${bin}`,
      source_type: "cli",
      name: bin,
      canonical_name: `bin:${bin}`,
      description: meta.description,
      keywords: meta.registry,
      bundle_path: path,
      last_seen_epoch: now,
      content_hash: contentHash(meta.description, meta.registry),
    }));
  }
  return out;
}
