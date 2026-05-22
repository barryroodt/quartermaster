import { existsSync, statSync } from "node:fs";
import { contentHash, type CapabilityRecord } from "./types.ts";

export interface CliKnown {
  description: string;
  registry: "brew" | "npm" | "cargo" | "system";
}

// POSIX-only PATH walker. Splits on ':' (not Windows-aware); requires
// regular file with at least one executable bit. Empty PATH segments
// are skipped (avoids CWD-as-PATH footgun).
export function which(bin: string): string | null {
  const path = process.env.PATH ?? "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    const candidate = `${dir}/${bin}`;
    if (!existsSync(candidate)) continue;
    try {
      const s = statSync(candidate);
      if (s.isFile() && (s.mode & 0o111) !== 0) return candidate;
    } catch {
      // statSync race or perm denial — skip and continue
    }
  }
  return null;
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
    out.push({
      id: `cli:bin:${bin}`,
      source_type: "cli",
      name: bin,
      canonical_name: `bin:${bin}`,
      description: meta.description,
      keywords: meta.registry,
      installed: 1,
      enabled: null,
      bundle_id: null,
      bundle_version: null,
      bundle_path: path,
      source_url: null,
      source_sha: null,
      last_seen_epoch: now,
      content_hash: contentHash(meta.description, meta.registry),
    });
  }
  return out;
}
