import type { FtsHit } from "./fts.ts";
import { trustLevel, type TrustConfig, type TrustLevel } from "../trust/derive.ts";
import { deriveInvocation, deriveBundleKind, type Invocation } from "./derive.ts";
import type { CapabilityRecord, SourceType } from "../inventory/types.ts";
import type { SurveyResult } from "../commands/survey.ts";

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

const DESC_TRUNC = 80;

export function printSurvey(r: SurveyResult): void {
  console.log("INSTALLED (use now):");
  for (const row of r.installed) {
    console.log(`  ${row.name} (${row.source_type}) — ${row.description?.slice(0, DESC_TRUNC) ?? ""}`);
  }
  console.log("\nGAP CANDIDATES:");
  for (const row of r.gap) {
    console.log(`  ${row.name} (${row.source_type}, ${row.trust_level}) — ${row.description?.slice(0, DESC_TRUNC) ?? ""}`);
  }
  if (r.degraded) console.log("\n⚠ matching degraded (no semantic rerank)");
  if (r.external_gaps.length > 0) {
    console.log("\nGAP CANDIDATES (external):");
    for (const g of r.external_gaps) {
      console.log(`  ${g.name} (${g.registry}) — ${g.description.slice(0, DESC_TRUNC)}`);
      console.log(`    install: ${g.install_command}`);
    }
  }
  // Text-only handoff — see docs/v0.2-roadmap.md for why EnterPlanMode
  // can't be invoked from a Bun subprocess.
  console.log(`\n[quartermaster] next: /plan "<your goal>"  # use surfaced capabilities during planning`);
}

export function printCapability(r: CapabilityRecord): void {
  console.log(`${r.source_type.padEnd(10)} ${r.canonical_name.padEnd(40)} ${r.description?.slice(0, DESC_TRUNC) ?? ""}`);
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
