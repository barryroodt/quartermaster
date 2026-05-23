import type { FtsHit } from "./fts.ts";
import { trustLevel, type TrustConfig, type TrustLevel } from "../trust/derive.ts";
import { deriveInvocation, deriveBundleKind, type Invocation } from "./derive.ts";
import type { SourceType } from "../inventory/types.ts";

export interface FormattedRow {
  id: string;
  source_type: SourceType;
  name: string;
  canonical_name: string;
  description: string | null;
  installed: number;
  bundle_id: string | null;
  bundle_kind: "plugin" | "marketplace" | null;
  source_url: string | null;
  source_sha: string | null;
  trust_level: TrustLevel;
  invocation: Invocation;
}

export interface FormattedResults {
  installed: FormattedRow[];
  gap: FormattedRow[];
}

export function formatResults(hits: FtsHit[], trustCfg: TrustConfig): FormattedResults {
  const rows: FormattedRow[] = hits.map(h => ({
    id: h.id,
    source_type: h.source_type,
    name: h.name,
    canonical_name: h.canonical_name,
    description: h.description,
    installed: h.installed,
    bundle_id: h.bundle_id,
    bundle_kind: deriveBundleKind(h.bundle_id),
    source_url: h.source_url,
    source_sha: h.source_sha,
    trust_level: trustLevel(h.source_url, trustCfg),
    invocation: deriveInvocation(h.source_type, h.canonical_name),
  }));
  return {
    installed: rows.filter(r => r.installed === 1),
    gap: rows.filter(r => r.installed === 0),
  };
}
