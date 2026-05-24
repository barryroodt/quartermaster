import { openDb } from "../db/connection.ts";

export function runPrune(dbPath: string): number {
  const db = openDb(dbPath);
  try {
    return db.query("DELETE FROM capabilities WHERE installed = 0 RETURNING id").all().length;
  } finally { db.close(); }
}
