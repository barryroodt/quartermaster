import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_PATH = join(import.meta.dir, "schema.sql");
const TARGET_VERSION = 1;

export function currentVersion(db: Database): number {
  try {
    const row = db.query("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null } | null;
    return row?.v ?? 0;
  } catch {
    return 0;
  }
}

export function migrate(db: Database): void {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema);
  const v = currentVersion(db);
  if (v < TARGET_VERSION) {
    db.query("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(TARGET_VERSION, Math.floor(Date.now() / 1000));
  }
}
