import { createHash } from "node:crypto";

export type SourceType = "skill" | "plugin" | "command" | "agent" | "mcp_server" | "mcp_tool" | "cli";

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

export function contentHash(description: string | null, keywords: string | null): string {
  return createHash("sha1").update(`${description ?? ""}\n${keywords ?? ""}`).digest("hex").slice(0, 12);
}
