import { openDb } from "../db/connection.ts";
import { COLS } from "../inventory/indexer.ts";
import type { CapabilityRecord } from "../inventory/types.ts";

export function runList(dbPath: string, sourceType?: string): CapabilityRecord[] {
  const db = openDb(dbPath);
  try {
    const cols = COLS.join(",");
    const sql = sourceType
      ? `SELECT ${cols} FROM capabilities WHERE source_type = ? ORDER BY id`
      : `SELECT ${cols} FROM capabilities ORDER BY id`;
    return (sourceType ? db.query(sql).all(sourceType) : db.query(sql).all()) as CapabilityRecord[];
  } finally { db.close(); }
}
