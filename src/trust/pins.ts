// Cold-path table: one write per install, one read per drift check.
// Statements are not prepared-once (cf. indexer.ts); the per-call query cost
// is negligible at this volume and keeps the module flat.

import type { Database } from "bun:sqlite";

export interface PinRow {
  capability_id: string;
  source_sha: string;
  pinned_by: "auto-trusted" | "user-confirm";
  source_url: string;
  pinned_at: number;
}

export function getPin(db: Database, capabilityId: string): PinRow | null {
  return db.query("SELECT capability_id, source_sha, pinned_by, source_url, pinned_at FROM trust_pins WHERE capability_id = ?")
    .get(capabilityId) as PinRow | null;
}

export interface WritePinInput {
  capability_id: string;
  source_sha: string;
  pinned_by: "auto-trusted" | "user-confirm";
  source_url: string;
  pinned_at?: number;
}

// Re-pinning the same (capability_id, source_sha) preserves the original
// pinned_at — audit trail must record FIRST-trust date, not last-write date.
// Only a real SHA change re-stamps the timestamp.
export function writePin(db: Database, pin: WritePinInput): void {
  const now = pin.pinned_at ?? Math.floor(Date.now() / 1000);
  db.query(`
    INSERT INTO trust_pins (capability_id, source_sha, pinned_at, pinned_by, source_url)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(capability_id) DO UPDATE SET
      source_sha = excluded.source_sha,
      pinned_by  = excluded.pinned_by,
      source_url = excluded.source_url,
      pinned_at  = CASE WHEN trust_pins.source_sha != excluded.source_sha
                        THEN excluded.pinned_at
                        ELSE trust_pins.pinned_at END
  `).run(pin.capability_id, pin.source_sha, now, pin.pinned_by, pin.source_url);
}

export type DriftStatus = "no-pin" | "match" | "drift";

export function driftCheck(db: Database, capabilityId: string, currentSha: string): DriftStatus {
  const pin = getPin(db, capabilityId);
  if (!pin) return "no-pin";
  return pin.source_sha === currentSha ? "match" : "drift";
}
