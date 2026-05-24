import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";
import { enumerateMcp, type ToolsListFetcher } from "../../src/inventory/enum-mcp";

let tmpDir: string;
let dbPath: string;
let db: ReturnType<typeof openDb> | null = null;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "qm-mcp-"));
  dbPath = join(tmpDir, "test.db");
  db = null;
});

afterEach(() => {
  if (db) { db.close(); db = null; }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("enumerateMcp", () => {
  test("emits one mcp_server record per server config", async () => {
    db = openDb(dbPath);
    migrate(db);
    const servers = { foo: { command: "/bin/foo", args: [] }, bar: { url: "https://bar/mcp" } };
    const fetcher: ToolsListFetcher = async () => [];
    const records = await enumerateMcp(servers, db, fetcher);
    const serverRecords = records.filter(r => r.source_type === "mcp_server");
    expect(serverRecords.length).toBe(2);
    expect(serverRecords.map(r => r.canonical_name).sort()).toEqual(["bar", "foo"]);
  });

  test("calls fetcher per server, emits mcp_tool records, caches by config hash", async () => {
    db = openDb(dbPath);
    migrate(db);
    const servers = { foo: { command: "/bin/foo" } };
    const calls: string[] = [];
    const fetcher: ToolsListFetcher = async (name) => {
      calls.push(name);
      return [{ name: "do_x", description: "Does X." }];
    };
    const r1 = await enumerateMcp(servers, db, fetcher);
    const toolRecs1 = r1.filter(r => r.source_type === "mcp_tool");
    expect(toolRecs1.length).toBe(1);
    expect(toolRecs1[0].canonical_name).toBe("mcp__foo__do_x");

    const r2 = await enumerateMcp(servers, db, fetcher);
    expect(calls.length).toBe(1);
    expect(r2.filter(r => r.source_type === "mcp_tool").length).toBe(1);
  });

  test("re-fetches when server config changes", async () => {
    db = openDb(dbPath);
    migrate(db);
    let calls = 0;
    const fetcher: ToolsListFetcher = async () => { calls++; return [{ name: "t" }]; };
    await enumerateMcp({ foo: { command: "/v1" } }, db, fetcher);
    await enumerateMcp({ foo: { command: "/v2" } }, db, fetcher);
    expect(calls).toBe(2);
  });
});
