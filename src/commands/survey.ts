import { join } from "node:path";
import { openDb } from "../db/connection.ts";
import { migrate } from "../db/migrate.ts";
import { ftsNarrow, type FtsHit } from "../matcher/fts.ts";
import { formatResults, type FormattedResults } from "../matcher/format.ts";
import { loadTrust } from "../trust/derive.ts";
import { MAX_RANKED, type RerankResult } from "../matcher/rerank.ts";

export interface SurveyArgs {
  dataDir: string;
  dbPath: string;
  goal: string;
  rerankImpl: (goal: string, hits: FtsHit[]) => Promise<RerankResult | null>;
}

export interface SurveyResult extends FormattedResults {
  degraded: boolean;
  refused: boolean;
  stop_reason: string | null;
}

export async function runSurvey(args: SurveyArgs): Promise<SurveyResult> {
  const trust = loadTrust(join(args.dataDir, "trust.json"));
  const db = openDb(args.dbPath);
  migrate(db);

  const row = db.query("SELECT COUNT(*) as c FROM capabilities").get() as { c: number };
  if (row.c === 0) {
    db.close();
    return { installed: [], gap: [], degraded: false, refused: true, stop_reason: null };
  }

  const hits = ftsNarrow(db, args.goal, 20);
  if (hits.length === 0) {
    db.close();
    return { installed: [], gap: [], degraded: false, refused: false, stop_reason: "exhausted" };
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
  return { ...formatted, degraded, refused: false, stop_reason: stop };
}
