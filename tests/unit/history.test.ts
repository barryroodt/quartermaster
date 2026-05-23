import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";
import { writeHistory, getHistory } from "../../src/installer/history";

let tmpDir: string | null = null;
let dbPath: string;
let db: ReturnType<typeof openDb> | null = null;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "qm-hist-"));
  dbPath = join(tmpDir, "t.db");
  db = openDb(dbPath);
  migrate(db);
});

afterEach(() => {
  if (db) { db.close(); db = null; }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

describe("install_history", () => {
  test("writeHistory then getHistory round-trips", () => {
    writeHistory(db!, {
      capability_id: "skill:skills-sh:foo/bar@x",
      source_sha: "abc123",
      installed_by: "auto-trusted",
    });
    const rows = getHistory(db!, "skill:skills-sh:foo/bar@x");
    expect(rows.length).toBe(1);
    expect(rows[0].source_sha).toBe("abc123");
    expect(rows[0].installed_by).toBe("auto-trusted");
    expect(typeof rows[0].installed_at).toBe("number");
  });

  test("multiple writes preserved in DESC order by installed_at", () => {
    writeHistory(db!, { capability_id: "x", source_sha: "sha1", installed_by: "auto-trusted", installed_at: 1000 });
    writeHistory(db!, { capability_id: "x", source_sha: "sha2", installed_by: "user-confirm", installed_at: 2000 });
    writeHistory(db!, { capability_id: "x", source_sha: "sha3", installed_by: "manual", installed_at: 3000 });
    const rows = getHistory(db!, "x");
    expect(rows.length).toBe(3);
    expect(rows[0].source_sha).toBe("sha3");
    expect(rows[1].source_sha).toBe("sha2");
    expect(rows[2].source_sha).toBe("sha1");
  });

  test("missing capability returns []", () => {
    expect(getHistory(db!, "skill:none")).toEqual([]);
  });
});
