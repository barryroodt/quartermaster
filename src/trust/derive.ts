import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { matches } from "./patterns.ts";

export interface TrustConfig {
  version: number;
  trusted_patterns: string[];
  blocked_patterns: string[];
}

const DEFAULT: TrustConfig = {
  version: 1,
  trusted_patterns: [
    "anthropic/*",
    "anthropics/*",
    "superpowers-marketplace",
    "claude-plugins-official",
  ],
  blocked_patterns: [],
};

export function loadTrust(path: string): TrustConfig {
  if (!existsSync(path)) return { version: 1, trusted_patterns: [], blocked_patterns: [] };
  try {
    const obj = JSON.parse(readFileSync(path, "utf8"));
    return {
      version: obj.version ?? 1,
      trusted_patterns: obj.trusted_patterns ?? [],
      blocked_patterns: obj.blocked_patterns ?? [],
    };
  } catch {
    return { version: 1, trusted_patterns: [], blocked_patterns: [] };
  }
}

export function saveTrust(path: string, cfg: TrustConfig): void {
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}

export function seedDefault(path: string): void {
  if (!existsSync(path)) saveTrust(path, DEFAULT);
}

function ownerRepoFromUrl(url: string): string | null {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:[/?].*)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export type TrustLevel = "trusted" | "unknown" | "blocked";

export function trustLevel(sourceUrl: string | null, cfg: TrustConfig): TrustLevel {
  if (!sourceUrl) return "unknown";
  const slug = ownerRepoFromUrl(sourceUrl);
  if (!slug) return "unknown";
  for (const p of cfg.blocked_patterns) if (matches(slug, p)) return "blocked";
  for (const p of cfg.trusted_patterns) if (matches(slug, p)) return "trusted";
  return "unknown";
}
