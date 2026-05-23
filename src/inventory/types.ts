export const SOURCE_TYPES = ["skill", "plugin", "command", "agent", "mcp_server", "mcp_tool", "cli"] as const;
export type SourceType = typeof SOURCE_TYPES[number];
export function isSourceType(s: string): s is SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(s);
}

export interface CapabilityRecord {
  id: string;
  source_type: SourceType;
  name: string;
  canonical_name: string;
  description: string | null;
  keywords: string | null;
  installed: 0 | 1;
  enabled: 0 | 1 | null;
  bundle_id: string | null;
  bundle_version: string | null;
  bundle_path: string | null;
  source_url: string | null;
  source_sha: string | null;
  last_seen_epoch: number;
  content_hash: string;
}

export interface BuildRecordInput {
  id: string;
  source_type: SourceType;
  name: string;
  canonical_name: string;
  description?: string | null;
  keywords?: string | null;
  installed?: 0 | 1;
  enabled?: 0 | 1 | null;
  bundle_id?: string | null;
  bundle_version?: string | null;
  bundle_path?: string | null;
  source_url?: string | null;
  source_sha?: string | null;
  last_seen_epoch: number;
  content_hash: string;
}

export function buildRecord(input: BuildRecordInput): CapabilityRecord {
  return {
    id: input.id,
    source_type: input.source_type,
    name: input.name,
    canonical_name: input.canonical_name,
    description: input.description ?? null,
    keywords: input.keywords ?? null,
    installed: input.installed ?? 1,
    enabled: input.enabled ?? null,
    bundle_id: input.bundle_id ?? null,
    bundle_version: input.bundle_version ?? null,
    bundle_path: input.bundle_path ?? null,
    source_url: input.source_url ?? null,
    source_sha: input.source_sha ?? null,
    last_seen_epoch: input.last_seen_epoch,
    content_hash: input.content_hash,
  };
}
