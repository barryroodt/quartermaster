import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { matches } from "./patterns.ts";

export interface TrustConfig {
  version: number;
  trusted_patterns: string[];
  blocked_patterns: string[];
}

const EMPTY: TrustConfig = { version: 1, trusted_patterns: [], blocked_patterns: [] };

const DEFAULT: TrustConfig = {
  version: 1,
  trusted_patterns: [
    "anthropic/*",
    "anthropics/*",
    "superpowers-marketplace/*",
    "claude-plugins-official/*",
  ],
  blocked_patterns: [],
};

function asStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((v): v is string => typeof v === "string");
}

// NOTE: callers SHOULD invoke seedDefault(path) at init before loadTrust(path),
// otherwise an absent file returns EMPTY (no trust floor) — which makes every
// install untrusted and forces a user-confirm prompt. seedDefault is a no-op
// when the file already exists.
export function loadTrust(path: string): TrustConfig {
  if (!existsSync(path)) return EMPTY;
  try {
    const obj = JSON.parse(readFileSync(path, "utf8"));
    return {
      version: typeof obj?.version === "number" ? obj.version : 1,
      trusted_patterns: asStringArray(obj?.trusted_patterns),
      blocked_patterns: asStringArray(obj?.blocked_patterns),
    };
  } catch {
    console.warn("[quartermaster] trust.json is malformed; treating as empty");
    return EMPTY;
  }
}

export function saveTrust(path: string, cfg: TrustConfig): void {
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}

export function seedDefault(path: string): void {
  if (!existsSync(path)) saveTrust(path, DEFAULT);
}

// github.com only. Non-github URLs derive trustLevel='unknown' regardless of
// trust config. If gitlab/bitbucket/etc. become first-class, generalise the
// slug shape (e.g. "host/owner/repo") and align validatePattern + matches.
function githubOwnerRepoFromUrl(url: string): string | null {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:[/?].*)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export type TrustLevel = "trusted" | "unknown" | "blocked";

export function trustLevel(sourceUrl: string | null, cfg: TrustConfig): TrustLevel {
  if (!sourceUrl) return "unknown";
  const slug = githubOwnerRepoFromUrl(sourceUrl);
  if (!slug) return "unknown";
  for (const p of cfg.blocked_patterns) if (matches(slug, p)) return "blocked";
  for (const p of cfg.trusted_patterns) if (matches(slug, p)) return "trusted";
  return "unknown";
}
