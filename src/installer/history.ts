import type { Database } from "bun:sqlite";

export type InstalledBy = "auto-trusted" | "user-confirm" | "manual" | "pre-existing";

export interface HistoryRow {
  capability_id: string;
  source_sha: string;
  installed_at: number;
  installed_by: InstalledBy;
}

export function writeHistory(db: Database, row: Omit<HistoryRow, "installed_at"> & { installed_at?: number }): void {
  const at = row.installed_at ?? Math.floor(Date.now() / 1000);
  db.query(
    "INSERT INTO install_history (capability_id, source_sha, installed_at, installed_by) VALUES (?, ?, ?, ?)"
  ).run(row.capability_id, row.source_sha, at, row.installed_by);
}

export function getHistory(db: Database, capabilityId: string): HistoryRow[] {
  return db.query(
    "SELECT capability_id, source_sha, installed_at, installed_by FROM install_history WHERE capability_id = ? ORDER BY installed_at DESC"
  ).all(capabilityId) as HistoryRow[];
}
