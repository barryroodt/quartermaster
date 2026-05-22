// Sole writer to the `capabilities` table. All mutations must go through
// `applyRecords` to preserve diff semantics + FTS invariants. INSERT OR REPLACE
// rewrites the row, so `rowid` changes on every update — never cache rowids
// across `applyRecords` calls.

import type { Database } from "bun:sqlite";
import type { CapabilityRecord } from "./types.ts";

const COLS = [
  "id", "source_type", "name", "canonical_name", "description", "keywords",
  "installed", "enabled", "bundle_id", "bundle_version", "bundle_path",
  "source_url", "source_sha", "last_seen_epoch", "content_hash",
] as const satisfies readonly (keyof CapabilityRecord)[];

export function applyRecords(db: Database, records: CapabilityRecord[]): void {
  db.transaction(() => {
    const incomingIds = new Set(records.map(r => r.id));
    const existing = db.query("SELECT id, content_hash FROM capabilities").all() as { id: string; content_hash: string }[];
    const existingMap = new Map(existing.map(e => [e.id, e.content_hash]));

    const del = db.prepare("DELETE FROM capabilities WHERE id = ?");
    for (const e of existing) {
      if (!incomingIds.has(e.id)) del.run(e.id);
    }

    const placeholders = COLS.map(() => "?").join(",");
    const insertSql = `INSERT OR REPLACE INTO capabilities (${COLS.join(",")}) VALUES (${placeholders})`;
    const insert = db.prepare(insertSql);
    for (const r of records) {
      if (existingMap.get(r.id) === r.content_hash) continue;
      insert.run(...COLS.map(c => r[c]));
    }
  })();
}

export function getAll(db: Database): CapabilityRecord[] {
  return db.query(`SELECT ${COLS.join(",")} FROM capabilities ORDER BY id`).all() as CapabilityRecord[];
}
