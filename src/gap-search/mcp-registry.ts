import { $ } from "bun";
import { buildWebSearchQuery } from "./websearch.ts";

export interface McpServerHit {
  registry: "smithery" | "web-search-suggested";
  name: string;
  // For smithery: qualifiedName like "@org/server-name". For web-search: the raw query.
  canonical: string;
  description: string;
  url: string;
  // Ready-to-paste /qm install line. For web-search-suggested, the "hint" is a
  // WebSearch query string for the agent to run via Claude Code's WebSearch tool.
  install_hint: string;
}

// Pure parser for smithery `search --json` output. Factored out of searchSmithery
// so the loose, defensively-parsed format can be unit-tested without mocking $.
// Smithery's JSON schema isn't strictly versioned; we accept any of qualifiedName,
// name, homepage, repository.
export function parseSmitheryOutput(raw: string): McpServerHit[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return (parsed as Array<Record<string, unknown>>)
    .slice(0, 5)
    .map(p => {
      const name =
        typeof p.qualifiedName === "string" ? p.qualifiedName :
        typeof p.name === "string" ? p.name : null;
      if (!name) return null;
      const desc = typeof p.description === "string" ? p.description : "";
      const url =
        typeof p.homepage === "string" ? p.homepage :
        typeof p.repository === "string" ? p.repository :
        `https://smithery.ai/server/${encodeURIComponent(name)}`;
      const hit: McpServerHit = {
        registry: "smithery",
        name,
        canonical: name,
        description: desc,
        url,
        install_hint: `/qm install mcp:${name} --yes --transport-arg=npx --transport-arg=-y --transport-arg=${name}`,
      };
      return hit;
    })
    .filter((h): h is McpServerHit => h !== null);
}

// Smithery CLI search via npx. Bootstraps via `npx -y` so no global install needed.
// Returns [] on any failure — gap search must be non-fatal.
export async function searchSmithery(query: string): Promise<McpServerHit[]> {
  try {
    const result = await $`npx -y @smithery/cli search ${query} --json`.quiet().nothrow();
    if (result.exitCode !== 0) return [];
    return parseSmitheryOutput(result.stdout.toString());
  } catch {
    return [];
  }
}

// Fallback when smithery returns nothing. The agent (or user) runs the suggested
// query via Claude Code's WebSearch tool — cli.ts cannot invoke agent tools directly.
export function suggestMcpWebSearch(query: string): McpServerHit {
  return {
    registry: "web-search-suggested",
    name: `web search for "mcp server ${query}"`,
    canonical: query,
    description: "Run this query via WebSearch to find MCP servers matching your goal",
    url: "",
    install_hint: buildWebSearchQuery("mcp_server", query),
  };
}
