import { openDb } from "../db/connection.ts";

// SQLite's res.changes reports cumulative changes from triggers (FTS5
// content-table triggers fire on DELETE), so we pre-count the target rows
// instead of trusting res.changes.
export function runPrune(dbPath: string): number {
  const db = openDb(dbPath);
  try {
    const row = db.query("SELECT COUNT(*) as c FROM capabilities WHERE installed = 0").get() as { c: number };
    db.query("DELETE FROM capabilities WHERE installed = 0").run();
    return row.c;
  } finally { db.close(); }
}
