import type { Database } from "bun:sqlite";
import SYNONYMS from "./synonyms.json" with { type: "json" };

export interface FtsHit {
  id: string;
  source_type: string;
  name: string;
  description: string | null;
  installed: number;
  bundle_id: string | null;
  source_url: string | null;
  source_sha: string | null;
  rank: number;
}

export function expandQuery(goal: string): string {
  const cleaned = goal.toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").trim();
  const tokens = cleaned.split(/\s+/).filter(t => t.length > 1);
  const expanded = new Set<string>();
  for (const t of tokens) {
    expanded.add(t);
    const syns = (SYNONYMS as Record<string, string[]>)[t];
    if (syns) for (const s of syns) expanded.add(s);
  }
  return [...expanded].join(" OR ");
}

export function ftsNarrow(db: Database, goal: string, limit = 20): FtsHit[] {
  const query = expandQuery(goal);
  if (!query) return [];
  try {
    return db.query(`
      SELECT c.id, c.source_type, c.name, c.description, c.installed,
             c.bundle_id, c.source_url, c.source_sha,
             bm25(capabilities_fts, 4.0, 3.0, 1.0, 1.5) AS rank
      FROM capabilities_fts
      JOIN capabilities c ON c.rowid = capabilities_fts.rowid
      WHERE capabilities_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as FtsHit[];
  } catch {
    return [];
  }
}
