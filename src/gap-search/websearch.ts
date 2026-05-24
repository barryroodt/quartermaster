import type { SourceType } from "../inventory/types.ts";

export type GapSourceType = Extract<SourceType, "skill" | "mcp_server" | "cli">;

export function buildWebSearchQuery(type: GapSourceType, terms: string): string {
  switch (type) {
    case "skill":      return `site:github.com "SKILL.md" claude ${terms}`;
    case "mcp_server": return `"mcp server" ${terms} site:github.com`;
    case "cli":        return `${terms} CLI tool site:github.com OR site:crates.io`;
  }
}
