import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { contentHash, type CapabilityRecord } from "./types.ts";

export type ToolsListFetcher = (serverName: string, config: unknown) => Promise<Array<{ name: string; description?: string }>>;

function configHash(cfg: unknown): string {
  return createHash("sha1").update(JSON.stringify(cfg)).digest("hex").slice(0, 12);
}

export async function enumerateMcp(
  servers: Record<string, unknown>,
  db: Database,
  fetcher: ToolsListFetcher,
): Promise<CapabilityRecord[]> {
  const out: CapabilityRecord[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (const [name, cfg] of Object.entries(servers)) {
    const hash = configHash(cfg);

    out.push({
      id: `mcp_server:${name}`,
      source_type: "mcp_server",
      name,
      canonical_name: name,
      description: null,
      keywords: null,
      installed: 1,
      enabled: null,
      bundle_id: null,
      bundle_version: null,
      bundle_path: null,
      source_url: null,
      source_sha: hash,
      last_seen_epoch: now,
      content_hash: contentHash(null, null),
    });

    const cached = db.query("SELECT tools_json FROM mcp_tool_cache WHERE server_name = ? AND server_config_hash = ?")
      .get(name, hash) as { tools_json: string } | null;

    let tools: Array<{ name: string; description?: string }>;
    let fetchOk = true;
    if (cached) {
      tools = JSON.parse(cached.tools_json);
    } else {
      try {
        tools = await fetcher(name, cfg);
      } catch {
        tools = [];
        fetchOk = false;
      }
      if (fetchOk) {
        db.query("INSERT OR REPLACE INTO mcp_tool_cache (server_name, server_config_hash, tools_json, fetched_at) VALUES (?, ?, ?, ?)")
          .run(name, hash, JSON.stringify(tools), now);
      }
    }

    for (const t of tools) {
      const canonical = `mcp__${name}__${t.name}`;
      out.push({
        id: `mcp_tool:${canonical}`,
        source_type: "mcp_tool",
        name: t.name,
        canonical_name: canonical,
        description: t.description ?? null,
        keywords: null,
        installed: 1,
        enabled: null,
        bundle_id: name,
        bundle_version: null,
        bundle_path: null,
        source_url: null,
        source_sha: null,
        last_seen_epoch: now,
        content_hash: contentHash(t.description ?? null, null),
      });
    }
  }
  return out;
}
