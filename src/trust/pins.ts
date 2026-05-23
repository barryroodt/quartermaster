import type { Database } from "bun:sqlite";

export interface PinRow {
  capability_id: string;
  source_sha: string;
  pinned_by: "auto-trusted" | "user-confirm" | "pre-existing";
  source_url: string;
}

export function getPin(db: Database, capabilityId: string): PinRow | null {
  return db.query("SELECT capability_id, source_sha, pinned_by, source_url FROM trust_pins WHERE capability_id = ?")
    .get(capabilityId) as PinRow | null;
}

export function writePin(db: Database, pin: PinRow): void {
  db.query(`INSERT OR REPLACE INTO trust_pins (capability_id, source_sha, pinned_at, pinned_by, source_url)
            VALUES (?, ?, ?, ?, ?)`)
    .run(pin.capability_id, pin.source_sha, Math.floor(Date.now() / 1000), pin.pinned_by, pin.source_url);
}

export type DriftStatus = "no-pin" | "match" | "drift";

export function driftCheck(db: Database, capabilityId: string, currentSha: string): DriftStatus {
  const pin = getPin(db, capabilityId);
  if (!pin) return "no-pin";
  return pin.source_sha === currentSha ? "match" : "drift";
}
