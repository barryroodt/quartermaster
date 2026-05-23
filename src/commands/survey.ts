import { join } from "node:path";
import { openDb } from "../db/connection.ts";
import { migrate } from "../db/migrate.ts";
import { ftsNarrow, type FtsHit } from "../matcher/fts.ts";
import { formatResults, type FormattedResults } from "../matcher/format.ts";
import { loadTrust } from "../trust/derive.ts";
import { MAX_RANKED, type RerankResult } from "../matcher/rerank.ts";
import {
  searchSkillsSh,
  searchBrew,
  RegistrySearchFailed,
  type RegistryHit,
} from "../gap-search/registries.ts";

// Threshold below which we escalate to external registries. Cheap heuristic —
// "we found nothing useful locally, so look outward". Tunable.
const THIN_INSTALLED_THRESHOLD = 3;
const MAX_EXTERNAL_GAPS = 6;

export interface ExternalGap {
  capability_id: string;
  name: string;
  description: string;
  registry: "skills.sh" | "brew";
  url: string;
  install_command: string;
}

export interface SurveyArgs {
  dataDir: string;
  dbPath: string;
  goal: string;
  rerankImpl: (goal: string, hits: FtsHit[]) => Promise<RerankResult | null>;
  // Override for tests; defaults to parallel skills.sh + brew search.
  gapSearchImpl?: (query: string) => Promise<RegistryHit[]>;
}

export interface SurveyResult extends FormattedResults {
  degraded: boolean;
  refused: boolean;
  stop_reason: string | null;
  external_gaps: ExternalGap[];
}

function hitToGap(hit: RegistryHit): ExternalGap {
  if (hit.registry === "skills.sh") {
    const capabilityId = `skill:skills-sh:${hit.canonical}`;
    return {
      capability_id: capabilityId,
      name: hit.name,
      description: `skills.sh skill (${hit.installs} installs)`,
      registry: "skills.sh",
      url: hit.url,
      install_command: `/qm install ${capabilityId}`,
    };
  }
  const capabilityId = `cli:brew:${hit.name}`;
  return {
    capability_id: capabilityId,
    name: hit.name,
    description: "homebrew formula",
    registry: "brew",
    url: hit.url,
    install_command: `/qm install ${capabilityId}`,
  };
}

async function defaultGapSearch(query: string): Promise<RegistryHit[]> {
  // Each search wrapped so a single registry failure doesn't sink the other.
  const settle = async (label: "skills.sh" | "brew", fn: () => Promise<RegistryHit[]>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof RegistrySearchFailed) {
        console.error(`[quartermaster] gap-search ${label} failed: ${e.message}`);
        return [];
      }
      console.error(`[quartermaster] gap-search ${label} crashed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  };
  const [a, b] = await Promise.all([
    settle("skills.sh", () => searchSkillsSh(query)),
    settle("brew", () => searchBrew(query)),
  ]);
  return [...a, ...b];
}

export async function runSurvey(args: SurveyArgs): Promise<SurveyResult> {
  const trust = loadTrust(join(args.dataDir, "trust.json"));
  const db = openDb(args.dbPath);
  migrate(db);

  const row = db.query("SELECT COUNT(*) as c FROM capabilities").get() as { c: number };
  if (row.c === 0) {
    db.close();
    return { installed: [], gap: [], degraded: false, refused: true, stop_reason: null, external_gaps: [] };
  }

  const hits = ftsNarrow(db, args.goal, 20);
  if (hits.length === 0) {
    db.close();
    return { installed: [], gap: [], degraded: false, refused: false, stop_reason: "exhausted", external_gaps: [] };
  }

  const ranked = await args.rerankImpl(args.goal, hits);
  let topHits: FtsHit[];
  let degraded = false;
  let stop: string | null = null;
  if (!ranked) {
    degraded = true;
    topHits = hits.slice(0, MAX_RANKED);
  } else {
    stop = ranked.stop_reason;
    const byId = new Map(hits.map(h => [h.id, h]));
    topHits = ranked.ranked.map(r => byId.get(r.id)).filter((h): h is FtsHit => !!h);
    if (topHits.length < ranked.ranked.length) {
      console.warn(`[quartermaster] rerank returned ${ranked.ranked.length - topHits.length} unknown ids; dropped`);
    }
  }

  const formatted = formatResults(topHits, trust);
  db.close();

  // Escalate to external registries when the installed bucket is thin —
  // gives the planner external candidates to consider alongside locals.
  let external_gaps: ExternalGap[] = [];
  if (formatted.installed.length < THIN_INSTALLED_THRESHOLD) {
    const search = args.gapSearchImpl ?? defaultGapSearch;
    const hits = await search(args.goal);
    external_gaps = hits.slice(0, MAX_EXTERNAL_GAPS).map(hitToGap);
  }

  return { ...formatted, degraded, refused: false, stop_reason: stop, external_gaps };
}
