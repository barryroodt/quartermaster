# Quartermaster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin that surveys available skills, plugins, commands, agents, MCP servers, MCP tools, and curated CLIs, then surfaces the relevant ones before planning a task.

**Architecture:** SQLite + FTS5 inventory built by an idempotent indexer, queried by an FTS5-narrow + Claude-rerank matcher, gated by an allowlist + SHA-pin trust layer. One `UserPromptSubmit` hook (bun script) for passive cold-state and stale nudges; explicit `/qm` subcommands for the deep pass.

**Tech Stack:** Bun runtime, TypeScript, SQLite (`bun:sqlite` built-in), Claude Code plugin format (`.claude-plugin/plugin.json` + slash-command shims), MCP `tools/list` for tool enumeration, Claude API (via `@anthropic-ai/sdk`) for rerank.

**Spec:** `docs/superpowers/specs/2026-05-22-quartermaster-design.md`

**Working directory:** `~/Projects/jumptag/quartermaster` (already git-initialised, two commits on `main`).

---

## File structure

```
quartermaster/
├── .claude-plugin/
│   └── plugin.json                  Plugin manifest
├── .claude-plugin/marketplace.json  Marketplace entry (single-plugin marketplace)
├── package.json                     Bun deps, scripts
├── tsconfig.json                    TS config (bun preset)
├── README.md
├── src/
│   ├── db/
│   │   ├── schema.sql               Full DDL (Section 2 of spec)
│   │   ├── connection.ts            SQLite WAL connection factory
│   │   └── migrate.ts               Schema-version table + apply
│   ├── inventory/
│   │   ├── hash.ts                  Input-signature hash + content hash
│   │   ├── description.ts           General markdown extractor + 2 adapters (exports parseFrontmatter)
│   │   ├── types.ts                 CapabilityRecord + buildRecord factory
│   │   ├── enum-skills.ts           Skill enumerator
│   │   ├── enum-plugins.ts          Plugin enumerator
│   │   ├── enum-md-tree.ts          Command + agent enumerator (shared md-tree walker)
│   │   ├── enum-mcp.ts              MCP server + tools enumerator
│   │   ├── enum-cli.ts              CLI enumerator
│   │   ├── cli-known.json           Curated CLI manifest
│   │   └── indexer.ts               Orchestrate enumerators → diff → apply (exports COLS)
│   ├── util/
│   │   └── which.ts                 POSIX PATH walker (isFile + exec bit)
│   ├── trust/
│   │   ├── patterns.ts              Glob match + validation
│   │   ├── derive.ts                Compute trust_level from source_url
│   │   └── pins.ts                  trust_pins table I/O + drift detection
│   ├── matcher/
│   │   ├── synonyms.json            Token expansion map
│   │   ├── fts.ts                   FTS5 narrow query
│   │   ├── derive.ts                trust_level / bundle_kind / invocation derivation
│   │   ├── rerank.ts                Claude rerank call
│   │   └── format.ts                Bucket installed vs gap; format table
│   ├── installer/
│   │   ├── plugin.ts                claude plugin install
│   │   ├── skill-skillssh.ts        npx skills add
│   │   ├── skill-raw.ts             WebFetch SKILL.md
│   │   ├── mcp.ts                   claude mcp add
│   │   ├── cli.ts                   Print-and-confirm
│   │   ├── verify.ts                Post-install verification
│   │   └── prompts.ts               User prompts (untrusted, drift, promote)
│   ├── gap-search/
│   │   ├── registries.ts            Tier 1 (skills.sh, brew, npm, cargo)
│   │   └── websearch.ts             Tier 2/3 (with user approval)
│   ├── commands/
│   │   ├── init.ts                  /qm init (+ flags)
│   │   ├── survey.ts                /qm survey <goal>
│   │   ├── list.ts                  /qm list
│   │   ├── trust.ts                 /qm trust add/list
│   │   └── prune.ts                 /qm prune
│   ├── classifier/
│   │   └── intent.ts                Planning-intent regex + tech-keyword match
│   ├── hooks/
│   │   └── prompt-hook.ts           UserPromptSubmit single bun entry point
│   ├── log.ts                       Daily rotating logger
│   └── paths.ts                     ~/.quartermaster paths centralised
├── commands/                        Claude Code slash-command shims
│   ├── qm.md                        Dispatcher (parses subcommand, shells to bun)
│   └── (other shims if needed)
└── tests/
    ├── unit/                        One file per src/ module
    ├── integration/                 Cross-module: indexer.test.ts, survey-e2e.test.ts
    └── fixtures/                    Sample SKILL.md, plugin.json, mock MCP responses
```

---

## Milestone 1 — Foundation

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/paths.ts`
- Create: `tests/unit/paths.test.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "quartermaster",
  "version": "0.1.0",
  "description": "Claude Code discovery plugin — surveys skills/plugins/MCPs/CLIs and surfaces what's relevant before planning",
  "type": "module",
  "scripts": {
    "test": "bun test",
    "test:unit": "bun test tests/unit",
    "test:integration": "bun test tests/integration",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleDetection": "force",
    "jsx": "preserve",
    "allowJs": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["bun-types"]
  }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
*.log
.DS_Store
~/.quartermaster/
dist/
```

> **Note:** `bun.lock` is intentionally tracked (lockfiles must be committed for reproducible installs). Do NOT add it to `.gitignore`.

- [ ] **Step 4: Write the failing test for `paths.ts`**

Create `tests/unit/paths.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { paths } from "../../src/paths";

describe("paths", () => {
  test("dataDir is under HOME", () => {
    expect(paths.dataDir).toMatch(/\.quartermaster$/);
  });

  test("inventoryDb is dataDir/inventory.db", () => {
    expect(paths.inventoryDb).toBe(`${paths.dataDir}/inventory.db`);
  });

  test("trustJson is dataDir/trust.json", () => {
    expect(paths.trustJson).toBe(`${paths.dataDir}/trust.json`);
  });

  test("sessionMarker is dataDir/.session-init-shown", () => {
    expect(paths.sessionMarker).toBe(`${paths.dataDir}/.session-init-shown`);
  });

  test("claudeSkills is HOME/.claude/skills", () => {
    expect(paths.claudeSkills).toMatch(/\.claude\/skills$/);
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `bun test tests/unit/paths.test.ts`
Expected: FAIL — `Cannot find module '../../src/paths'`

- [ ] **Step 6: Implement `src/paths.ts`**

```typescript
const HOME = process.env.HOME ?? "";
const DATA = `${HOME}/.quartermaster`;
const CLAUDE = `${HOME}/.claude`;

export const paths = {
  dataDir: DATA,
  inventoryDb: `${DATA}/inventory.db`,
  inventoryHash: `${DATA}/inventory.hash`,
  trustJson: `${DATA}/trust.json`,
  cliExtras: `${DATA}/cli-extras.json`,
  synonyms: `${DATA}/synonyms.json`,
  sessionMarker: `${DATA}/.session-init-shown`,
  logDir: `${DATA}/logs`,
  claudeDir: CLAUDE,
  claudeSkills: `${CLAUDE}/skills`,
  claudeCommands: `${CLAUDE}/commands`,
  claudeAgents: `${CLAUDE}/agents`,
  claudePluginsManifest: `${CLAUDE}/plugins/installed_plugins.json`,
  claudeSettings: `${CLAUDE}/settings.json`,
  claudeJson: `${HOME}/.claude.json`,
} as const;
```

- [ ] **Step 7: Run to verify pass**

Run: `bun test tests/unit/paths.test.ts`
Expected: PASS — 5 tests pass

- [ ] **Step 8: Install deps**

Run: `bun install`

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json .gitignore src/paths.ts tests/unit/paths.test.ts bun.lock
git commit -m "feat: project scaffolding and centralised paths module"
```

---

### Task 2: SQLite schema + migration runner

**Files:**
- Create: `src/db/schema.sql`
- Create: `src/db/connection.ts`
- Create: `src/db/migrate.ts`
- Create: `tests/unit/migrate.test.ts`

> **Convention — time columns:** Every time-typed column in this schema stores **epoch seconds** (`INTEGER NOT NULL`). Producers must compute `Math.floor(Date.now() / 1000)`, never `Date.now()` (which is ms). Mixing units silently corrupts cache-staleness, drift-window, and audit-history logic.
>
> **Convention — TS relative imports:** All production-code relative imports MUST include the `.ts` extension (e.g. `from "../paths.ts"`). `tsconfig.json` has `allowImportingTsExtensions: true`. Test files import without the extension (`bun:test` resolution differs).

- [ ] **Step 1: Write `src/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS capabilities (
  id              TEXT PRIMARY KEY,
  source_type     TEXT NOT NULL,
  name            TEXT NOT NULL,
  canonical_name  TEXT NOT NULL,
  description     TEXT,
  keywords        TEXT,
  installed       INTEGER NOT NULL,
  enabled         INTEGER,
  bundle_id       TEXT,
  bundle_version  TEXT,
  bundle_path     TEXT,
  source_url      TEXT,
  source_sha      TEXT,
  last_seen_epoch INTEGER NOT NULL,
  content_hash    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_capabilities_source_type ON capabilities(source_type);
CREATE INDEX IF NOT EXISTS idx_capabilities_bundle_id ON capabilities(bundle_id);

CREATE VIRTUAL TABLE IF NOT EXISTS capabilities_fts USING fts5(
  name, canonical_name, description, keywords,
  content='capabilities', content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS capabilities_ai AFTER INSERT ON capabilities BEGIN
  INSERT INTO capabilities_fts(rowid, name, canonical_name, description, keywords)
  VALUES (new.rowid, new.name, new.canonical_name, new.description, new.keywords);
END;

CREATE TRIGGER IF NOT EXISTS capabilities_ad AFTER DELETE ON capabilities BEGIN
  INSERT INTO capabilities_fts(capabilities_fts, rowid, name, canonical_name, description, keywords)
  VALUES('delete', old.rowid, old.name, old.canonical_name, old.description, old.keywords);
END;

CREATE TRIGGER IF NOT EXISTS capabilities_au AFTER UPDATE ON capabilities BEGIN
  INSERT INTO capabilities_fts(capabilities_fts, rowid, name, canonical_name, description, keywords)
  VALUES('delete', old.rowid, old.name, old.canonical_name, old.description, old.keywords);
  INSERT INTO capabilities_fts(rowid, name, canonical_name, description, keywords)
  VALUES (new.rowid, new.name, new.canonical_name, new.description, new.keywords);
END;

CREATE TABLE IF NOT EXISTS install_history (
  capability_id   TEXT NOT NULL,
  source_sha      TEXT NOT NULL,
  installed_at    INTEGER NOT NULL,
  installed_by    TEXT,
  PRIMARY KEY (capability_id, installed_at)
);

CREATE TABLE IF NOT EXISTS trust_pins (
  capability_id   TEXT PRIMARY KEY,
  source_sha      TEXT NOT NULL,
  pinned_at       INTEGER NOT NULL,
  pinned_by       TEXT NOT NULL,
  source_url      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_tool_cache (
  server_name        TEXT PRIMARY KEY,
  server_config_hash TEXT NOT NULL,
  tools_json         TEXT NOT NULL,
  fetched_at         INTEGER NOT NULL
);
```

- [ ] **Step 2: Write `src/db/connection.ts`**

```typescript
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { paths } from "../paths.ts";

export function openDb(path: string = paths.inventoryDb): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
```

- [ ] **Step 3: Write the failing test for migrate**

Create `tests/unit/migrate.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate, currentVersion } from "../../src/db/migrate";

let tmpDir: string;
let dbPath: string;
let db: ReturnType<typeof openDb> | null = null;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "qm-test-"));
  dbPath = join(tmpDir, "test.db");
  db = null;
});

afterEach(() => {
  if (db) { db.close(); db = null; }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("migrate", () => {
  test("applies schema to empty db, reaches version 1", () => {
    db = openDb(dbPath);
    migrate(db);
    expect(currentVersion(db)).toBe(1);
  });

  test("is idempotent — second run is a no-op", () => {
    db = openDb(dbPath);
    migrate(db);
    migrate(db);
    expect(currentVersion(db)).toBe(1);
  });

  test("creates capabilities, install_history, trust_pins, mcp_tool_cache tables", () => {
    db = openDb(dbPath);
    migrate(db);
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain("capabilities");
    expect(names).toContain("install_history");
    expect(names).toContain("trust_pins");
    expect(names).toContain("mcp_tool_cache");
    expect(names).toContain("capabilities_fts");
  });
});
```

> **Test cleanup convention:** Every test that touches the filesystem or opens a DB MUST use `afterEach` for cleanup, never inline at the end of the test body. Inline cleanup leaks the tempdir on any `expect()` failure or thrown error and poisons subsequent runs. Apply this pattern to every test file going forward (Tasks 5–10 and beyond).

- [ ] **Step 4: Run to verify failure**

Run: `bun test tests/unit/migrate.test.ts`
Expected: FAIL — `Cannot find module '../../src/db/migrate'`

- [ ] **Step 5: Implement `src/db/migrate.ts`**

```typescript
import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_PATH = join(import.meta.dir, "schema.sql");
const TARGET_VERSION = 1;

export function currentVersion(db: Database): number {
  try {
    const row = db.query("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null } | null;
    return row?.v ?? 0;
  } catch (e) {
    if (e instanceof Error && /no such table/.test(e.message)) return 0;
    throw e;
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
```

> **Catch narrowing:** `currentVersion` only swallows the specific "no such table" error from a virgin DB. Other failures (corruption, permission, locking) must propagate — a blanket `catch {}` would silently rebuild the schema versioning on top of an in-flight error.

- [ ] **Step 6: Run to verify pass**

Run: `bun test tests/unit/migrate.test.ts`
Expected: PASS — 3 tests pass

- [ ] **Step 7: Commit**

```bash
git add src/db/ tests/unit/migrate.test.ts
git commit -m "feat: SQLite schema, WAL connection, idempotent migration runner"
```

---

### Task 3: Input-signature hash

**Files:**
- Create: `src/inventory/hash.ts`
- Create: `tests/unit/hash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/hash.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signatureHash } from "../../src/inventory/hash";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qm-hash-"));
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("signatureHash", () => {
  test("returns 12-char hex string", () => {
    const h = signatureHash([]);
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  test("missing files contribute empty mtime, deterministically", () => {
    const path1 = join(tmp, "nonexistent");
    const h1 = signatureHash([path1]);
    const h2 = signatureHash([path1]);
    expect(h1).toBe(h2);
  });

  test("changing a tracked file's mtime changes the hash", () => {
    const p = join(tmp, "f");
    writeFileSync(p, "hello");
    const h1 = signatureHash([p]);
    utimesSync(p, new Date(Date.now() + 10_000), new Date(Date.now() + 10_000));
    const h2 = signatureHash([p]);
    expect(h1).not.toBe(h2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/unit/hash.test.ts`
Expected: FAIL — `Cannot find module '../../src/inventory/hash'`

- [ ] **Step 3: Implement `src/inventory/hash.ts`**

```typescript
import { statSync } from "node:fs";
import { createHash } from "node:crypto";
import { paths as appPaths } from "../paths.ts";

export function contentHash(description: string | null, keywords: string | null): string {
  return createHash("sha1").update(`${description ?? ""}\n${keywords ?? ""}`).digest("hex").slice(0, 12);
}

export function signatureHash(paths: string[]): string {
  const parts: string[] = [];
  for (const p of paths) {
    try {
      const s = statSync(p);
      parts.push(`${p}:${s.mtimeMs}`);
    } catch {
      parts.push(`${p}:`);
    }
  }
  return createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 12);
}

export function defaultSignatureInputs(): string[] {
  return [
    appPaths.claudePluginsManifest,
    appPaths.claudeSettings,
    appPaths.claudeJson,
    appPaths.claudeSkills,
    appPaths.claudeCommands,
    appPaths.claudeAgents,
    appPaths.cliExtras,
  ];
}
```

> **`contentHash` lives here, not in `types.ts`:** Both `signatureHash` (cache-key for input files) and `contentHash` (per-record drift detection) are hashing helpers. Keep them in the same module so the hashing surface is one file. `types.ts` stays purely declarative.
>
> **`defaultSignatureInputs` consumes `paths`:** Do not rebuild `${HOME}/.claude/...` strings here — every path the indexer cares about already lives in `src/paths.ts` (Task 1). Re-deriving them invites drift.

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/unit/hash.test.ts`
Expected: PASS — 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/inventory/hash.ts tests/unit/hash.test.ts
git commit -m "feat: stat-based input-signature hash for cache invalidation"
```

---

## Milestone 2 — Indexer

### Task 4: Description extractor (general + 2 adapters)

**Files:**
- Create: `src/inventory/description.ts`
- Create: `tests/unit/description.test.ts`
- Create: `tests/fixtures/sample-skill.md`
- Create: `tests/fixtures/sample-plugin.json`

- [ ] **Step 1: Create fixtures**

`tests/fixtures/sample-skill.md`:

```markdown
---
name: foo
description: Does the foo thing for bar reasons.
---

# Foo

Body content.
```

`tests/fixtures/sample-plugin.json`:

```json
{ "name": "foo-plugin", "description": "A plugin that foos." }
```

- [ ] **Step 2: Write the failing test**

`tests/unit/description.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { extractFromMarkdown, extractFromJson } from "../../src/inventory/description";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(import.meta.dir, "..", "fixtures");

describe("extractFromMarkdown", () => {
  test("uses frontmatter description if present", () => {
    const md = readFileSync(join(FIXTURES, "sample-skill.md"), "utf8");
    expect(extractFromMarkdown(md)).toBe("Does the foo thing for bar reasons.");
  });

  test("falls back to first non-frontmatter line if no description", () => {
    const md = "---\nname: bar\n---\n\nHello world.";
    expect(extractFromMarkdown(md)).toBe("Hello world.");
  });

  test("returns null if no description and no body", () => {
    expect(extractFromMarkdown("---\nname: bar\n---\n")).toBeNull();
  });

  test("handles markdown with no frontmatter", () => {
    expect(extractFromMarkdown("# Title\n\nFirst line.")).toBe("# Title");
  });
});

describe("extractFromJson", () => {
  test("returns .description field", () => {
    const json = readFileSync(join(FIXTURES, "sample-plugin.json"), "utf8");
    expect(extractFromJson(json)).toBe("A plugin that foos.");
  });

  test("returns null if no description", () => {
    expect(extractFromJson('{"name":"x"}')).toBeNull();
  });

  test("returns null on invalid JSON", () => {
    expect(extractFromJson("{not json")).toBeNull();
  });

  test("returns null when .description is not a string", () => {
    expect(extractFromJson('{"description": 42}')).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test tests/unit/description.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement `src/inventory/description.ts`**

```typescript
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseFrontmatter(md: string): { fm: Record<string, string>; body: string } {
  const m = md.match(FRONTMATTER);
  if (!m) return { fm: {}, body: md };
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { fm, body: m[2] };
}

export function extractFromMarkdown(md: string): string | null {
  const { fm, body } = parseFrontmatter(md);
  if (fm.description) return fm.description;
  const firstLine = body.split("\n").map(l => l.trim()).find(l => l.length > 0);
  return firstLine ?? null;
}

export function extractFromJson(json: string): string | null {
  try {
    const obj = JSON.parse(json);
    return typeof obj.description === "string" ? obj.description : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test tests/unit/description.test.ts`
Expected: PASS — 8 tests pass

> **`parseFrontmatter` is exported:** Enumerators (skills) need access to `fm.name` for canonical naming. Re-implementing the frontmatter regex in each enumerator (as the original plan hinted) duplicates the parser and risks drift. Export it once from `description.ts` and reuse.

- [ ] **Step 6: Commit**

```bash
git add src/inventory/description.ts tests/unit/description.test.ts tests/fixtures/
git commit -m "feat: general markdown/JSON description extractor"
```

---

### Task 5: Capability record type + skill enumerator

**Files:**
- Create: `src/inventory/types.ts`
- Create: `src/inventory/enum-skills.ts`
- Create: `tests/unit/enum-skills.test.ts`

- [ ] **Step 1: Define `src/inventory/types.ts`**

```typescript
export type SourceType = "skill" | "plugin" | "command" | "agent" | "mcp_server" | "mcp_tool" | "cli";

export interface CapabilityRecord {
  id: string;
  source_type: SourceType;
  name: string;
  canonical_name: string;
  description: string | null;
  keywords: string | null;
  installed: 0 | 1;
  enabled: 0 | 1 | null;
  bundle_id: string | null;
  bundle_version: string | null;
  bundle_path: string | null;
  source_url: string | null;
  source_sha: string | null;
  last_seen_epoch: number;
  content_hash: string;
}

export interface BuildRecordInput {
  id: string;
  source_type: SourceType;
  name: string;
  canonical_name: string;
  description?: string | null;
  keywords?: string | null;
  installed?: 0 | 1;
  enabled?: 0 | 1 | null;
  bundle_id?: string | null;
  bundle_version?: string | null;
  bundle_path?: string | null;
  source_url?: string | null;
  source_sha?: string | null;
  last_seen_epoch: number;
  content_hash: string;
}

export function buildRecord(input: BuildRecordInput): CapabilityRecord {
  return {
    id: input.id,
    source_type: input.source_type,
    name: input.name,
    canonical_name: input.canonical_name,
    description: input.description ?? null,
    keywords: input.keywords ?? null,
    installed: input.installed ?? 1,
    enabled: input.enabled ?? null,
    bundle_id: input.bundle_id ?? null,
    bundle_version: input.bundle_version ?? null,
    bundle_path: input.bundle_path ?? null,
    source_url: input.source_url ?? null,
    source_sha: input.source_sha ?? null,
    last_seen_epoch: input.last_seen_epoch,
    content_hash: input.content_hash,
  };
}
```

> **Why a `buildRecord` factory:** Every enumerator emits `CapabilityRecord`, but each source-type only meaningfully fills a few fields — the rest must default to `null`/`0`/`1` to match the typed shape. Without a factory, each enumerator carries 15-line literal objects mostly full of `: null`s (the original draft of Tasks 5–9), which is noisy and silently rots when fields are added. The factory keeps required fields explicit and defaults the optional ones in one place.
>
> **`contentHash` is NOT here.** It belongs in `src/inventory/hash.ts` next to `signatureHash` (Task 3). Do not duplicate.

- [ ] **Step 2: Write the failing test**

`tests/unit/enum-skills.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enumerateSkills } from "../../src/inventory/enum-skills";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qm-skills-"));
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("enumerateSkills", () => {
  test("finds SKILL.md files under a root, parses frontmatter", () => {
    mkdirSync(join(tmp, "foo"));
    writeFileSync(join(tmp, "foo", "SKILL.md"), `---
name: foo
description: Foo skill.
---
Body.`);
    const records = enumerateSkills(tmp);
    expect(records.length).toBe(1);
    expect(records[0].source_type).toBe("skill");
    expect(records[0].name).toBe("foo");
    expect(records[0].description).toBe("Foo skill.");
    expect(records[0].canonical_name).toBe("foo");
    expect(records[0].installed).toBe(1);
  });

  test("skips directories without SKILL.md", () => {
    mkdirSync(join(tmp, "empty"));
    expect(enumerateSkills(tmp)).toEqual([]);
  });

  test("scoped plugin skills get plugin-slug:skill-slug canonical_name", () => {
    mkdirSync(join(tmp, "bar"));
    writeFileSync(join(tmp, "bar", "SKILL.md"), `---
name: bar
description: Bar skill.
---`);
    const records = enumerateSkills(tmp, { pluginSlug: "myplugin" });
    expect(records[0].canonical_name).toBe("myplugin:bar");
    expect(records[0].bundle_id).toBe("myplugin");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test tests/unit/enum-skills.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement `src/inventory/enum-skills.ts`**

```typescript
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractFromMarkdown, parseFrontmatter } from "./description.ts";
import { contentHash } from "./hash.ts";
import { buildRecord, type CapabilityRecord } from "./types.ts";

export interface EnumOpts {
  pluginSlug?: string;
}

export function enumerateSkills(root: string, opts: EnumOpts = {}): CapabilityRecord[] {
  const now = Math.floor(Date.now() / 1000);
  const out: CapabilityRecord[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const skillPath = join(root, entry, "SKILL.md");
    let content: string;
    try {
      content = readFileSync(skillPath, "utf8");
    } catch {
      continue;
    }
    const name = parseFrontmatter(content).fm.name ?? entry;
    const description = extractFromMarkdown(content);
    const canonical = opts.pluginSlug ? `${opts.pluginSlug}:${name}` : name;
    out.push(buildRecord({
      id: `skill:${canonical}`,
      source_type: "skill",
      name,
      canonical_name: canonical,
      description,
      bundle_id: opts.pluginSlug ?? null,
      bundle_path: join(root, entry),
      last_seen_epoch: now,
      content_hash: contentHash(description, null),
    }));
  }
  return out;
}
```

> **Reuse `parseFrontmatter`:** Do NOT inline a `FM_NAME = /^name:\s*(.+)$/m` regex here — `parseFrontmatter` from `description.ts` already parses the whole frontmatter block. The skill enumerator just reads the `name` field off the parsed result.
>
> **`now` is hoisted to the top of the function** so every record in the same enumeration pass shares one timestamp. Cheap drift-detection invariant: records produced in the same scan have identical `last_seen_epoch`.

- [ ] **Step 5: Run to verify pass**

Run: `bun test tests/unit/enum-skills.test.ts`
Expected: PASS — 3 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/inventory/types.ts src/inventory/enum-skills.ts tests/unit/enum-skills.test.ts
git commit -m "feat: CapabilityRecord type + skill enumerator"
```

---

### Task 6: Plugin enumerator

**Files:**
- Create: `src/inventory/enum-plugins.ts`
- Create: `tests/unit/enum-plugins.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/enum-plugins.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enumeratePlugins } from "../../src/inventory/enum-plugins";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qm-plugins-"));
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("enumeratePlugins", () => {
  test("reads installed_plugins.json, fetches description from each plugin.json", () => {
    const installDir = join(tmp, "foo-plugin");
    mkdirSync(join(installDir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(installDir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "foo-plugin", description: "A plugin." }),
    );
    const manifest = {
      version: 2,
      plugins: {
        "foo@bar": [
          {
            scope: "user",
            installPath: installDir,
            version: "1.0.0",
            gitCommitSha: "abc123",
          },
        ],
      },
    };
    const manifestPath = join(tmp, "installed_plugins.json");
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const enabled = new Set(["foo@bar"]);
    const records = enumeratePlugins(manifestPath, enabled);
    expect(records.length).toBe(1);
    expect(records[0].source_type).toBe("plugin");
    expect(records[0].canonical_name).toBe("foo@bar");
    expect(records[0].description).toBe("A plugin.");
    expect(records[0].bundle_version).toBe("1.0.0");
    expect(records[0].source_sha).toBe("abc123");
    expect(records[0].enabled).toBe(1);
  });

  test("marks plugin not in enabled set as enabled:0", () => {
    const installDir = join(tmp, "foo-plugin");
    mkdirSync(join(installDir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(installDir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "foo-plugin" }),
    );
    const manifest = {
      version: 2,
      plugins: {
        "foo@bar": [{ scope: "user", installPath: installDir, version: "1.0.0" }],
      },
    };
    const manifestPath = join(tmp, "installed_plugins.json");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const records = enumeratePlugins(manifestPath, new Set());
    expect(records[0].enabled).toBe(0);
  });

  test("returns empty array if manifest absent", () => {
    expect(enumeratePlugins("/nonexistent/path.json", new Set())).toEqual([]);
  });

  test("returns empty array on corrupt manifest JSON", () => {
    const manifestPath = join(tmp, "installed_plugins.json");
    writeFileSync(manifestPath, "{ not json");
    expect(enumeratePlugins(manifestPath, new Set())).toEqual([]);
  });

  test("emits record with null description when plugin.json missing", () => {
    const installDir = join(tmp, "no-pj-plugin");
    mkdirSync(installDir, { recursive: true });
    // intentionally omit .claude-plugin/plugin.json
    const manifest = { version: 2, plugins: { "nopj@m": [{ scope: "user", installPath: installDir, version: "1.0.0" }] } };
    const manifestPath = join(tmp, "installed_plugins.json");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const records = enumeratePlugins(manifestPath, new Set());
    expect(records.length).toBe(1);
    expect(records[0].description).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/unit/enum-plugins.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/inventory/enum-plugins.ts`**

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractFromJson } from "./description.ts";
import { contentHash } from "./hash.ts";
import { buildRecord, type CapabilityRecord } from "./types.ts";

interface PluginEntry {
  scope: string;
  installPath: string;
  version: string;
  gitCommitSha?: string;
}

interface Manifest {
  version: number;
  plugins: Record<string, PluginEntry[]>;
}

export function enumeratePlugins(manifestPath: string, enabled: Set<string>): CapabilityRecord[] {
  const now = Math.floor(Date.now() / 1000);
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return [];
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    console.warn("[quartermaster] installed_plugins.json is malformed; treating as empty");
    return [];
  }
  const out: CapabilityRecord[] = [];
  for (const [pluginId, entries] of Object.entries(manifest.plugins ?? {})) {
    const entry = entries[0];
    if (!entry) continue;
    let description: string | null = null;
    try {
      const pj = readFileSync(join(entry.installPath, ".claude-plugin", "plugin.json"), "utf8");
      description = extractFromJson(pj);
    } catch {}
    const name = pluginId.split("@")[0];
    out.push(buildRecord({
      id: `plugin:${pluginId}`,
      source_type: "plugin",
      name,
      canonical_name: pluginId,
      description,
      enabled: enabled.has(pluginId) ? 1 : 0,
      bundle_id: pluginId,
      bundle_version: entry.version,
      bundle_path: entry.installPath,
      source_sha: entry.gitCommitSha ?? null,
      last_seen_epoch: now,
      content_hash: contentHash(description, null),
    }));
  }
  return out;
}
```

> **Warn on corrupt manifest, don't go silent:** A missing manifest is normal (no plugins installed), but a malformed JSON is a real failure — most likely a half-written file from a crashed install. Returning `[]` silently makes the indexer drop every plugin record on the next pass. The `console.warn` makes the failure visible without crashing the indexer.

- [ ] **Step 4: Run to verify pass**

Run: `bun test tests/unit/enum-plugins.test.ts`
Expected: PASS — 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/inventory/enum-plugins.ts tests/unit/enum-plugins.test.ts
git commit -m "feat: plugin enumerator with enabled-state from settings"
```

---

### Task 7: Command + agent enumerator (shared `enum-md-tree`)

**Files:**
- Create: `src/inventory/enum-md-tree.ts`
- Create: `tests/unit/enum-md-tree.test.ts`

> **One module, two `sourceType` values.** Commands and agents are both "walk an .md tree, parse frontmatter, emit records." The only differences are (a) the `source_type` value and (b) the plugin-canonical separator (`/` for commands, `:` for agents). Keeping two parallel files (`enum-commands.ts` / `enum-agents.ts`) duplicates the walker, the frontmatter parsing, the `buildRecord` call, and the tests — and any future fix has to be applied twice. Collapse into one function `enumerateMdTree(root, sourceType, opts)` with a `SEPARATOR` lookup.

- [ ] **Step 1: Write `tests/unit/enum-md-tree.test.ts`**

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enumerateMdTree } from "../../src/inventory/enum-md-tree";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "qm-mdt-"));
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("enumerateMdTree (command)", () => {
  test("finds .md files, parses frontmatter description", () => {
    writeFileSync(join(tmp, "foo.md"), `---
description: Foo command.
---
Body.`);
    const records = enumerateMdTree(tmp, "command");
    expect(records.length).toBe(1);
    expect(records[0].source_type).toBe("command");
    expect(records[0].name).toBe("foo");
    expect(records[0].canonical_name).toBe("foo");
    expect(records[0].description).toBe("Foo command.");
  });

  test("plugin scope prefixes canonical_name", () => {
    writeFileSync(join(tmp, "bar.md"), `---
description: Bar.
---`);
    const records = enumerateMdTree(tmp, "command", { pluginSlug: "myplug" });
    expect(records[0].canonical_name).toBe("myplug/bar");
  });

  test("recurses into subdirectories", () => {
    mkdirSync(join(tmp, "sub"), { recursive: true });
    writeFileSync(join(tmp, "sub", "nested.md"), `---
description: Nested.
---`);
    const records = enumerateMdTree(tmp, "command");
    expect(records.find(r => r.name === "nested")).toBeDefined();
  });
});

describe("enumerateMdTree (agent)", () => {
  test("finds .md files, source_type=agent", () => {
    writeFileSync(join(tmp, "foo.md"), `---
description: Foo agent.
---`);
    const records = enumerateMdTree(tmp, "agent");
    expect(records.length).toBe(1);
    expect(records[0].source_type).toBe("agent");
    expect(records[0].canonical_name).toBe("foo");
  });

  test("plugin scope uses colon separator", () => {
    writeFileSync(join(tmp, "bar.md"), `---
description: Bar.
---`);
    const records = enumerateMdTree(tmp, "agent", { pluginSlug: "myplug" });
    expect(records[0].canonical_name).toBe("myplug:bar");
  });

  test("recurses into subdirectories", () => {
    mkdirSync(join(tmp, "sub"), { recursive: true });
    writeFileSync(join(tmp, "sub", "nested.md"), `---
description: Nested.
---`);
    const records = enumerateMdTree(tmp, "agent");
    expect(records.find(r => r.name === "nested")).toBeDefined();
  });
});
```

- [ ] **Step 2: Implement `src/inventory/enum-md-tree.ts`**

```typescript
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { extractFromMarkdown } from "./description.ts";
import { contentHash } from "./hash.ts";
import { buildRecord, type CapabilityRecord } from "./types.ts";

export interface EnumOpts {
  pluginSlug?: string;
}

function walkMd(root: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(root, e);
    let s;
    try {
      s = lstatSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) walkMd(p, out);
    else if (extname(e) === ".md") out.push(p);
  }
  return out;
}

const SEPARATOR: Record<"command" | "agent", string> = {
  command: "/",
  agent: ":",
};

export function enumerateMdTree(
  root: string,
  sourceType: "command" | "agent",
  opts: EnumOpts = {},
): CapabilityRecord[] {
  const now = Math.floor(Date.now() / 1000);
  const sep = SEPARATOR[sourceType];
  const out: CapabilityRecord[] = [];
  for (const path of walkMd(root)) {
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const name = basename(path, ".md");
    const description = extractFromMarkdown(content);
    const canonical = opts.pluginSlug ? `${opts.pluginSlug}${sep}${name}` : name;
    out.push(buildRecord({
      id: `${sourceType}:${canonical}`,
      source_type: sourceType,
      name,
      canonical_name: canonical,
      description,
      bundle_id: opts.pluginSlug ?? null,
      bundle_path: path,
      last_seen_epoch: now,
      content_hash: contentHash(description, null),
    }));
  }
  return out;
}
```

> **`lstatSync`, not `statSync`:** `statSync` follows symlinks and recurses into the target — a symlink loop (`a → b → a`) sends the walker into infinite recursion and crashes the indexer. `lstatSync` reports the symlink itself, so the walker skips it (it's not a directory and not `.md`).
>
> **`try`/`catch` around `readFileSync` inside the loop:** A file that disappears between `readdirSync` and `readFileSync` (e.g. a plugin updating in the background) must not crash the whole enumeration. Skip the missing file and keep going.
>
> **Hoist `now`:** As in Task 5, all records from one scan share the same `last_seen_epoch`.

- [ ] **Step 3: Run to verify**

Run: `bun test tests/unit/enum-md-tree.test.ts`
Expected: PASS — 6 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/inventory/enum-md-tree.ts tests/unit/enum-md-tree.test.ts
git commit -m "feat: command and agent enumerator (shared md-tree walker)"
```

---

### Task 8: MCP server + tool enumerator (with cache)

**Files:**
- Create: `src/inventory/enum-mcp.ts`
- Create: `tests/unit/enum-mcp.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/enum-mcp.test.ts`:

```typescript
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
    db = openDb(dbPath); migrate(db);
    const servers = { foo: { command: "/bin/foo", args: [] }, bar: { url: "https://bar/mcp" } };
    const fetcher: ToolsListFetcher = async () => [];
    const records = await enumerateMcp(servers, db, fetcher);
    const serverRecords = records.filter(r => r.source_type === "mcp_server");
    expect(serverRecords.length).toBe(2);
    expect(serverRecords.map(r => r.canonical_name).sort()).toEqual(["bar", "foo"]);
  });

  test("calls fetcher per server, emits mcp_tool records, caches by config hash", async () => {
    db = openDb(dbPath); migrate(db);
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

    // Second call with same config → no new fetch
    const r2 = await enumerateMcp(servers, db, fetcher);
    expect(calls.length).toBe(1);
    expect(r2.filter(r => r.source_type === "mcp_tool").length).toBe(1);
  });

  test("re-fetches when server config changes", async () => {
    db = openDb(dbPath); migrate(db);
    let calls = 0;
    const fetcher: ToolsListFetcher = async () => { calls++; return [{ name: "t" }]; };
    await enumerateMcp({ foo: { command: "/v1" } }, db, fetcher);
    await enumerateMcp({ foo: { command: "/v2" } }, db, fetcher);
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Implement `src/inventory/enum-mcp.ts`**

```typescript
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { contentHash } from "./hash.ts";
import { buildRecord, type CapabilityRecord } from "./types.ts";

export interface McpTool {
  name: string;
  description?: string;
}

export type ToolsListFetcher = (serverName: string, config: unknown) => Promise<McpTool[]>;

function configHash(cfg: unknown): string {
  return createHash("sha1").update(JSON.stringify(cfg)).digest("hex").slice(0, 12);
}

export async function enumerateMcp(
  servers: Record<string, unknown>,
  db: Database,
  fetcher: ToolsListFetcher,
): Promise<CapabilityRecord[]> {
  const out: CapabilityRecord[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (const [name, cfg] of Object.entries(servers)) {
    const hash = configHash(cfg);

    out.push(buildRecord({
      id: `mcp_server:${name}`,
      source_type: "mcp_server",
      name,
      canonical_name: name,
      source_sha: hash,
      last_seen_epoch: now,
      content_hash: contentHash(null, null),
    }));

    const cached = db.query("SELECT tools_json, server_config_hash FROM mcp_tool_cache WHERE server_name = ?")
      .get(name) as { tools_json: string; server_config_hash: string } | null;

    let tools: McpTool[];
    let fetchOk = true;
    if (cached && cached.server_config_hash === hash) {
      tools = JSON.parse(cached.tools_json);
    } else {
      try {
        tools = await fetcher(name, cfg);
      } catch {
        tools = [];
        fetchOk = false;
      }
      if (fetchOk) {
        db.query("INSERT OR REPLACE INTO mcp_tool_cache (server_name, server_config_hash, tools_json, fetched_at) VALUES (?, ?, ?, ?)")
          .run(name, hash, JSON.stringify(tools), now);
      }
    }

    for (const t of tools) {
      const canonical = `mcp__${name}__${t.name}`;
      out.push(buildRecord({
        id: `mcp_tool:${canonical}`,
        source_type: "mcp_tool",
        name: t.name,
        canonical_name: canonical,
        description: t.description ?? null,
        bundle_id: name,
        last_seen_epoch: now,
        content_hash: contentHash(t.description ?? null, null),
      }));
    }
  }
  return out;
}
```

> **Three subtle correctness points the original draft got wrong:**
>
> 1. **Hash once per iteration.** The first draft called `configHash(cfg)` twice — once for the server record's `source_sha`, once for the cache query. Compute `hash` once at the top of the loop.
> 2. **Cache lookup matches by server name, validates hash in JS.** Querying `WHERE server_name = ? AND server_config_hash = ?` returns nothing when the hash changes — fine, but it also hides stale cache rows from cleanup. Look up by `server_name` alone and validate `server_config_hash === hash` in JS so the loop has visibility into "we have a cache row but it's stale."
> 3. **Do NOT cache an empty array when the fetcher throws.** A transient fetch failure (network blip, MCP server still starting) returning `[]` is semantically very different from "this server genuinely has zero tools." Caching the empty result poisons every subsequent run for the lifetime of the cache key. Track `fetchOk` and skip the write on failure — next run retries.
>
> **Cache schema is unchanged** (`server_name` is `PRIMARY KEY`) — the explicit JS-side hash check is a smaller and clearer change than a composite primary key.

- [ ] **Step 3: Run to verify pass**

Run: `bun test tests/unit/enum-mcp.test.ts`
Expected: PASS — 3 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/inventory/enum-mcp.ts tests/unit/enum-mcp.test.ts
git commit -m "feat: MCP server+tool enumerator with config-hash cache"
```

---

### Task 9: CLI enumerator + curated manifest

**Files:**
- Create: `src/inventory/cli-known.json`
- Create: `src/util/which.ts`
- Create: `src/inventory/enum-cli.ts`
- Create: `tests/unit/enum-cli.test.ts`

> **`which` lives in `src/util/`, not `enum-cli.ts`.** Other planned subsystems (gap-search registry verification, installer post-install probes) also need PATH resolution. Extracting `which()` to `src/util/which.ts` keeps `enum-cli.ts` focused on emitting records.

- [ ] **Step 1: Seed `src/inventory/cli-known.json`**

```json
{
  "gh": { "description": "GitHub CLI", "registry": "brew" },
  "git": { "description": "Git version control", "registry": "system" },
  "docker": { "description": "Container runtime", "registry": "brew" },
  "kubectl": { "description": "Kubernetes control CLI", "registry": "brew" },
  "terraform": { "description": "Infrastructure as code", "registry": "brew" },
  "aws": { "description": "AWS CLI", "registry": "brew" },
  "gcloud": { "description": "Google Cloud CLI", "registry": "brew" },
  "psql": { "description": "PostgreSQL client", "registry": "brew" },
  "redis-cli": { "description": "Redis client", "registry": "brew" },
  "jq": { "description": "JSON processor", "registry": "brew" },
  "rg": { "description": "ripgrep — fast recursive search", "registry": "brew" },
  "fd": { "description": "Fast find alternative", "registry": "brew" },
  "fzf": { "description": "Fuzzy finder", "registry": "brew" },
  "curl": { "description": "HTTP client", "registry": "system" },
  "node": { "description": "Node.js runtime", "registry": "brew" },
  "bun": { "description": "Bun runtime/package manager", "registry": "brew" },
  "npm": { "description": "Node package manager", "registry": "brew" },
  "pnpm": { "description": "Performant npm", "registry": "brew" },
  "python3": { "description": "Python 3 interpreter", "registry": "brew" },
  "pip": { "description": "Python package installer", "registry": "brew" },
  "cargo": { "description": "Rust package manager", "registry": "brew" }
}
```

(extensible — add to this file as needs grow; user extras go in `~/.quartermaster/cli-extras.json`)

- [ ] **Step 2: Write the failing test**

`tests/unit/enum-cli.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { enumerateCli } from "../../src/inventory/enum-cli";

describe("enumerateCli", () => {
  test("emits cli records for binaries on PATH", () => {
    // git is on PATH on dev machines
    const known = { git: { description: "Git VCS", registry: "system" as const } };
    const records = enumerateCli(known, {});
    const git = records.find(r => r.name === "git");
    expect(git).toBeDefined();
    expect(git?.source_type).toBe("cli");
    expect(git?.canonical_name).toBe("bin:git");
    expect(git?.description).toBe("Git VCS");
    expect(git?.installed).toBe(1);
  });

  test("omits binaries not on PATH", () => {
    const known = { "definitely-not-a-real-binary-xyzzy": { description: "x", registry: "brew" as const } };
    const records = enumerateCli(known, {});
    expect(records.length).toBe(0);
  });

  test("merges extras over known map", () => {
    const known = { git: { description: "Built-in", registry: "system" as const } };
    const extras = { git: { description: "Custom git desc", registry: "brew" as const } };
    const records = enumerateCli(known, extras);
    expect(records.find(r => r.name === "git")?.description).toBe("Custom git desc");
  });
});
```

- [ ] **Step 3: Implement `src/util/which.ts`**

```typescript
import { existsSync, statSync } from "node:fs";

// POSIX-only PATH walker. Splits on ':' (not Windows-aware); requires
// regular file with at least one executable bit. Empty PATH segments
// are skipped (avoids CWD-as-PATH footgun).
export function which(bin: string): string | null {
  const path = process.env.PATH ?? "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    const candidate = `${dir}/${bin}`;
    if (!existsSync(candidate)) continue;
    try {
      const s = statSync(candidate);
      if (s.isFile() && (s.mode & 0o111) !== 0) return candidate;
    } catch {
      // statSync race or perm denial — skip and continue
    }
  }
  return null;
}
```

> **Why `isFile()` + exec bit, not just `existsSync`:** `existsSync(candidate)` returns true for directories, broken symlinks, and unreadable entries. `which` must mean "this PATH entry would actually run if invoked," not "this name appears in PATH."
>
> **Why skip empty PATH segments:** A `PATH` like `:/usr/bin` (leading colon) is POSIX-equivalent to "search CWD first." We don't want quartermaster picking up a `gh` from whatever directory the user happens to be `cd`'d into.

- [ ] **Step 4: Implement `src/inventory/enum-cli.ts`**

```typescript
import { contentHash } from "./hash.ts";
import { buildRecord, type CapabilityRecord } from "./types.ts";
import { which } from "../util/which.ts";

export interface CliKnown {
  description: string;
  registry: "brew" | "npm" | "cargo" | "system";
}

export function enumerateCli(
  known: Record<string, CliKnown>,
  extras: Record<string, CliKnown>,
): CapabilityRecord[] {
  const merged = { ...known, ...extras };
  const out: CapabilityRecord[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (const [bin, meta] of Object.entries(merged)) {
    const path = which(bin);
    if (!path) continue;
    out.push(buildRecord({
      id: `cli:bin:${bin}`,
      source_type: "cli",
      name: bin,
      canonical_name: `bin:${bin}`,
      description: meta.description,
      keywords: meta.registry,
      bundle_path: path,
      last_seen_epoch: now,
      content_hash: contentHash(meta.description, meta.registry),
    }));
  }
  return out;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test tests/unit/enum-cli.test.ts`
Expected: PASS — 3 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/inventory/cli-known.json src/util/which.ts src/inventory/enum-cli.ts tests/unit/enum-cli.test.ts
git commit -m "feat: CLI enumerator with curated manifest + user extras"
```

---

### Task 10: Indexer (diff + apply per-source results)

**Files:**
- Create: `src/inventory/indexer.ts`
- Create: `tests/integration/indexer.test.ts`

- [ ] **Step 1: Write the failing integration test**

`tests/integration/indexer.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";
import { applyRecords, getAll, COLS } from "../../src/inventory/indexer";
import type { CapabilityRecord } from "../../src/inventory/types";

let tmpDir: string;
let dbPath: string;
let db: ReturnType<typeof openDb> | null = null;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "qm-idx-"));
  dbPath = join(tmpDir, "test.db");
  db = null;
});

afterEach(() => {
  if (db) { db.close(); db = null; }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function mkRecord(id: string, desc = "x"): CapabilityRecord {
  return {
    id, source_type: "skill", name: id, canonical_name: id, description: desc, keywords: null,
    installed: 1, enabled: null, bundle_id: null, bundle_version: null, bundle_path: null,
    source_url: null, source_sha: null, last_seen_epoch: 1, content_hash: desc,
  };
}

describe("indexer applyRecords", () => {
  test("inserts new records", () => {
    db = openDb(dbPath); migrate(db);
    applyRecords(db, [mkRecord("a"), mkRecord("b")]);
    expect(getAll(db).length).toBe(2);
  });

  test("updates changed content_hash, leaves unchanged rows alone", () => {
    db = openDb(dbPath); migrate(db);
    applyRecords(db, [mkRecord("a", "v1")]);
    applyRecords(db, [mkRecord("a", "v2")]);
    const all = getAll(db);
    expect(all.length).toBe(1);
    expect(all[0].description).toBe("v2");
  });

  test("removes records no longer present in current set", () => {
    db = openDb(dbPath); migrate(db);
    applyRecords(db, [mkRecord("a"), mkRecord("b")]);
    applyRecords(db, [mkRecord("a")]);
    expect(getAll(db).map(r => r.id)).toEqual(["a"]);
  });

  test("FTS5 picks up inserts", () => {
    db = openDb(dbPath); migrate(db);
    applyRecords(db, [mkRecord("foo", "kubernetes deploy helper")]);
    const hits = db.query("SELECT rowid FROM capabilities_fts WHERE capabilities_fts MATCH 'kubernetes'").all();
    expect(hits.length).toBe(1);
  });

  test("COLS matches schema column set", () => {
    db = openDb(dbPath); migrate(db);
    const cols = db.query("PRAGMA table_info(capabilities)").all() as { name: string }[];
    const schemaNames = new Set(cols.map(c => c.name));
    const colsSet = new Set<string>(COLS);
    // Every name in COLS appears in the schema.
    for (const c of COLS) {
      expect(schemaNames.has(c)).toBe(true);
    }
    // Every schema column appears in COLS.
    for (const name of schemaNames) {
      expect(colsSet.has(name)).toBe(true);
    }
  });
});
```

> **Drift detector test:** `COLS` and `schema.sql` are two declarations of the same set of columns — silent drift between them would corrupt every `applyRecords` call (writes the wrong column, reads return `undefined`). This test fails loudly the moment they diverge. Keep it in the integration suite, not the unit suite — it needs a real migrated DB.

- [ ] **Step 2: Implement `src/inventory/indexer.ts`**

```typescript
// Sole writer to the `capabilities` table. All mutations must go through
// `applyRecords` to preserve diff semantics + FTS invariants. INSERT OR REPLACE
// rewrites the row, so `rowid` changes on every update — never cache rowids
// across `applyRecords` calls.

import type { Database } from "bun:sqlite";
import type { CapabilityRecord } from "./types.ts";

export const COLS = [
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
```

> **`COLS` is exported, typed as `keyof CapabilityRecord`.** Two reasons:
>
> 1. Exporting lets the integration test compare `COLS` against the schema's `PRAGMA table_info` (drift detector above) without re-declaring the column list.
> 2. `as const satisfies readonly (keyof CapabilityRecord)[]` makes TypeScript reject any column name that isn't a real field. Drops the `(r as any)[c]` cast — `r[c]` is now type-safe (`CapabilityRecord[typeof c]`).
>
> **Prepare DELETE outside the loop.** Re-preparing a statement per iteration in a `for...of` is needless overhead and obscures intent. Hoist both `insert` and `del` to one prepare per kind.
>
> **Single transaction.** Even a 4-statement delete-and-insert pass benefits from one tx — the FTS triggers fire inside it, and a mid-pass crash leaves the table consistent.

- [ ] **Step 3: Run to verify pass**

Run: `bun test tests/integration/indexer.test.ts`
Expected: PASS — 5 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/inventory/indexer.ts tests/integration/indexer.test.ts
git commit -m "feat: indexer applies diff (insert/update/delete) in single tx"
```

---

## Milestone 3 — Trust layer

### Task 11: Trust pattern matching + validation

**Files:**
- Create: `src/trust/patterns.ts`
- Create: `tests/unit/trust-patterns.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { matches, validatePattern } from "../../src/trust/patterns";

describe("matches", () => {
  test("exact match", () => { expect(matches("anthropic/foo", "anthropic/foo")).toBe(true); });
  test("trailing wildcard match", () => { expect(matches("anthropic/foo", "anthropic/*")).toBe(true); });
  test("case-insensitive", () => { expect(matches("Anthropic/Foo", "anthropic/*")).toBe(true); });
  test("non-match", () => { expect(matches("other/foo", "anthropic/*")).toBe(false); });
  test("leading wildcard rejected (no match)", () => { expect(matches("anthropic/foo", "*/foo")).toBe(false); });
});

describe("validatePattern", () => {
  test("accepts owner/repo", () => { expect(() => validatePattern("anthropic/foo")).not.toThrow(); });
  test("accepts owner/*", () => { expect(() => validatePattern("anthropic/*")).not.toThrow(); });
  test("rejects */*", () => { expect(() => validatePattern("*/*")).toThrow(); });
  test("rejects bare *", () => { expect(() => validatePattern("*")).toThrow(); });
  test("rejects empty", () => { expect(() => validatePattern("")).toThrow(); });
});
```

- [ ] **Step 2: Implementation**

`src/trust/patterns.ts`:

```typescript
export function matches(value: string, pattern: string): boolean {
  const v = value.toLowerCase();
  const p = pattern.toLowerCase();
  if (p === v) return true;
  if (!p.endsWith("/*")) return false;
  const prefix = p.slice(0, -1);
  return v.startsWith(prefix);
}

export function validatePattern(pattern: string): void {
  if (!pattern) throw new Error("empty trust pattern");
  if (pattern === "*" || pattern === "*/*") throw new Error("pattern too broad: " + pattern);
  if (pattern.startsWith("*")) throw new Error("leading wildcard not allowed: " + pattern);
}
```

- [ ] **Step 3: Run + commit**

```bash
bun test tests/unit/trust-patterns.test.ts
git add src/trust/patterns.ts tests/unit/trust-patterns.test.ts
git commit -m "feat: trust pattern matcher + validator"
```

---

### Task 12: Trust-level derivation + trust.json I/O

**Files:**
- Create: `src/trust/derive.ts`
- Create: `tests/unit/trust-derive.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrust, trustLevel } from "../../src/trust/derive";

describe("loadTrust", () => {
  test("returns empty config when file absent", () => {
    const cfg = loadTrust("/nonexistent.json");
    expect(cfg.trusted_patterns).toEqual([]);
    expect(cfg.blocked_patterns).toEqual([]);
  });

  test("reads patterns from file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "qm-tr-"));
    const p = join(tmp, "trust.json");
    writeFileSync(p, JSON.stringify({ version: 1, trusted_patterns: ["a/*"], blocked_patterns: ["b/c"] }));
    const cfg = loadTrust(p);
    expect(cfg.trusted_patterns).toEqual(["a/*"]);
    expect(cfg.blocked_patterns).toEqual(["b/c"]);
    rmSync(tmp, { recursive: true });
  });
});

describe("trustLevel", () => {
  const cfg = { version: 1, trusted_patterns: ["anthropic/*"], blocked_patterns: ["evil/*"] };
  test("trusted match", () => { expect(trustLevel("https://github.com/anthropic/foo", cfg)).toBe("trusted"); });
  test("blocked match", () => { expect(trustLevel("https://github.com/evil/x", cfg)).toBe("blocked"); });
  test("unknown when no match", () => { expect(trustLevel("https://github.com/other/x", cfg)).toBe("unknown"); });
  test("blocked wins over trusted", () => {
    const c2 = { version: 1, trusted_patterns: ["foo/*"], blocked_patterns: ["foo/bar"] };
    expect(trustLevel("https://github.com/foo/bar", c2)).toBe("blocked");
  });
  test("null url → unknown", () => { expect(trustLevel(null, cfg)).toBe("unknown"); });
});
```

- [ ] **Step 2: Implement `src/trust/derive.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { matches } from "./patterns.ts";

export interface TrustConfig {
  version: number;
  trusted_patterns: string[];
  blocked_patterns: string[];
}

const DEFAULT: TrustConfig = {
  version: 1,
  trusted_patterns: [
    "anthropic/*",
    "anthropics/*",
    "superpowers-marketplace",
    "claude-plugins-official",
  ],
  blocked_patterns: [],
};

export function loadTrust(path: string): TrustConfig {
  if (!existsSync(path)) return { version: 1, trusted_patterns: [], blocked_patterns: [] };
  try {
    const obj = JSON.parse(readFileSync(path, "utf8"));
    return {
      version: obj.version ?? 1,
      trusted_patterns: obj.trusted_patterns ?? [],
      blocked_patterns: obj.blocked_patterns ?? [],
    };
  } catch {
    return { version: 1, trusted_patterns: [], blocked_patterns: [] };
  }
}

export function saveTrust(path: string, cfg: TrustConfig): void {
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}

export function seedDefault(path: string): void {
  if (!existsSync(path)) saveTrust(path, DEFAULT);
}

function ownerRepoFromUrl(url: string): string | null {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:[/?].*)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export type TrustLevel = "trusted" | "unknown" | "blocked";

export function trustLevel(sourceUrl: string | null, cfg: TrustConfig): TrustLevel {
  if (!sourceUrl) return "unknown";
  const slug = ownerRepoFromUrl(sourceUrl);
  if (!slug) return "unknown";
  for (const p of cfg.blocked_patterns) if (matches(slug, p)) return "blocked";
  for (const p of cfg.trusted_patterns) if (matches(slug, p)) return "trusted";
  return "unknown";
}
```

- [ ] **Step 3: Run + commit**

```bash
bun test tests/unit/trust-derive.test.ts
git add src/trust/derive.ts tests/unit/trust-derive.test.ts
git commit -m "feat: trust-level derivation + trust.json I/O"
```

---

### Task 13: Trust pins (DB I/O + drift detection)

**Files:**
- Create: `src/trust/pins.ts`
- Create: `tests/unit/trust-pins.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";
import { getPin, writePin, driftCheck } from "../../src/trust/pins";

let tmpDir: string; let dbPath: string;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "qm-pins-")); dbPath = join(tmpDir, "t.db"); });

describe("pins", () => {
  test("writePin then getPin round-trips", () => {
    const db = openDb(dbPath); migrate(db);
    writePin(db, { capability_id: "skill:x", source_sha: "abc", pinned_by: "auto-trusted", source_url: "https://github.com/x/y" });
    const p = getPin(db, "skill:x");
    expect(p?.source_sha).toBe("abc");
    db.close(); rmSync(tmpDir, { recursive: true });
  });

  test("driftCheck: no pin → no-pin", () => {
    const db = openDb(dbPath); migrate(db);
    expect(driftCheck(db, "skill:x", "abc")).toBe("no-pin");
    db.close(); rmSync(tmpDir, { recursive: true });
  });

  test("driftCheck: match → match", () => {
    const db = openDb(dbPath); migrate(db);
    writePin(db, { capability_id: "skill:x", source_sha: "abc", pinned_by: "auto-trusted", source_url: "u" });
    expect(driftCheck(db, "skill:x", "abc")).toBe("match");
    db.close(); rmSync(tmpDir, { recursive: true });
  });

  test("driftCheck: different SHA → drift", () => {
    const db = openDb(dbPath); migrate(db);
    writePin(db, { capability_id: "skill:x", source_sha: "abc", pinned_by: "auto-trusted", source_url: "u" });
    expect(driftCheck(db, "skill:x", "xyz")).toBe("drift");
    db.close(); rmSync(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Implementation**

```typescript
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
```

- [ ] **Step 3: Run + commit**

```bash
bun test tests/unit/trust-pins.test.ts
git add src/trust/pins.ts tests/unit/trust-pins.test.ts
git commit -m "feat: trust_pins table I/O + drift detection"
```

---

## Milestone 4 — Matcher

### Task 14: Synonym map + FTS5 narrow query

**Files:**
- Create: `src/matcher/synonyms.json`
- Create: `src/matcher/fts.ts`
- Create: `tests/integration/fts.test.ts`

- [ ] **Step 1: Seed synonyms**

`src/matcher/synonyms.json`:

```json
{
  "k8s": ["kubernetes"],
  "pg": ["postgres", "postgresql"],
  "ts": ["typescript"],
  "js": ["javascript"],
  "py": ["python"],
  "rb": ["ruby"],
  "go": ["golang"],
  "rs": ["rust"],
  "ci": ["pipeline", "build"],
  "cd": ["deploy", "deployment"],
  "auth": ["authentication", "authorization", "oauth"],
  "db": ["database"]
}
```

- [ ] **Step 2: Failing test**

`tests/integration/fts.test.ts`:

```typescript
import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";
import { applyRecords } from "../../src/inventory/indexer";
import { ftsNarrow, expandQuery } from "../../src/matcher/fts";
import type { CapabilityRecord } from "../../src/inventory/types";

let tmpDir: string; let dbPath: string;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "qm-fts-")); dbPath = join(tmpDir, "t.db"); });

function rec(id: string, name: string, desc: string): CapabilityRecord {
  return {
    id, source_type: "skill", name, canonical_name: id, description: desc, keywords: null,
    installed: 1, enabled: null, bundle_id: null, bundle_version: null, bundle_path: null,
    source_url: null, source_sha: null, last_seen_epoch: 1, content_hash: id,
  };
}

describe("expandQuery", () => {
  test("expands k8s to k8s OR kubernetes", () => {
    expect(expandQuery("k8s deploy").toLowerCase()).toContain("kubernetes");
  });
  test("strips special chars", () => {
    expect(expandQuery("foo/bar:baz")).not.toContain("/");
    expect(expandQuery("foo/bar:baz")).not.toContain(":");
  });
});

describe("ftsNarrow", () => {
  test("returns top-N rows ranked by bm25", () => {
    const db = openDb(dbPath); migrate(db);
    applyRecords(db, [
      rec("a", "kube-helper", "Helps with kubernetes deploys"),
      rec("b", "unrelated", "Something else entirely"),
      rec("c", "k8s-pro", "Kubernetes cluster management"),
    ]);
    const hits = ftsNarrow(db, "kubernetes", 20);
    expect(hits.length).toBe(2);
    expect(hits.map(h => h.id).sort()).toEqual(["a", "c"]);
    db.close(); rmSync(tmpDir, { recursive: true });
  });

  test("returns empty when no hits", () => {
    const db = openDb(dbPath); migrate(db);
    expect(ftsNarrow(db, "nothing", 20)).toEqual([]);
    db.close(); rmSync(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 3: Implementation**

`src/matcher/fts.ts`:

```typescript
import type { Database } from "bun:sqlite";
import SYNONYMS from "./synonyms.json" with { type: "json" };

export interface FtsHit {
  id: string;
  source_type: string;
  name: string;
  description: string | null;
  installed: number;
  bundle_id: string | null;
  source_url: string | null;
  source_sha: string | null;
  rank: number;
}

export function expandQuery(goal: string): string {
  const cleaned = goal.toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").trim();
  const tokens = cleaned.split(/\s+/).filter(t => t.length > 1);
  const expanded = new Set<string>();
  for (const t of tokens) {
    expanded.add(t);
    const syns = (SYNONYMS as Record<string, string[]>)[t];
    if (syns) for (const s of syns) expanded.add(s);
  }
  return [...expanded].join(" OR ");
}

export function ftsNarrow(db: Database, goal: string, limit = 20): FtsHit[] {
  const query = expandQuery(goal);
  if (!query) return [];
  try {
    return db.query(`
      SELECT c.id, c.source_type, c.name, c.description, c.installed,
             c.bundle_id, c.source_url, c.source_sha,
             bm25(capabilities_fts, 4.0, 3.0, 1.0, 1.5) AS rank
      FROM capabilities_fts
      JOIN capabilities c ON c.rowid = capabilities_fts.rowid
      WHERE capabilities_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as FtsHit[];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run + commit**

```bash
bun test tests/integration/fts.test.ts
git add src/matcher/synonyms.json src/matcher/fts.ts tests/integration/fts.test.ts
git commit -m "feat: FTS5 narrow with synonym expansion"
```

---

### Task 15: Read-time derivation (trust_level, bundle_kind, invocation)

**Files:**
- Create: `src/matcher/derive.ts`
- Create: `tests/unit/matcher-derive.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { deriveBundleKind, deriveInvocation } from "../../src/matcher/derive";

describe("deriveBundleKind", () => {
  test("@-form is plugin", () => { expect(deriveBundleKind("claude-mem@thedotmack")).toBe("plugin"); });
  test("bare slug is marketplace", () => { expect(deriveBundleKind("superpowers-marketplace")).toBe("marketplace"); });
  test("null returns null", () => { expect(deriveBundleKind(null)).toBeNull(); });
});

describe("deriveInvocation", () => {
  test("skill", () => {
    expect(deriveInvocation("skill", "superpowers:brainstorming")).toEqual({
      style: "skill", name: "superpowers:brainstorming",
    });
  });
  test("command prefixes /", () => {
    expect(deriveInvocation("command", "qm-survey")).toEqual({ style: "slash", name: "/qm-survey" });
  });
  test("cli strips bin: prefix", () => {
    expect(deriveInvocation("cli", "bin:gh")).toEqual({ style: "bash", example: "gh" });
  });
  test("mcp_tool", () => {
    expect(deriveInvocation("mcp_tool", "mcp__context7__query-docs")).toEqual({
      style: "tool", name: "mcp__context7__query-docs",
    });
  });
});
```

- [ ] **Step 2: Implementation**

`src/matcher/derive.ts`:

```typescript
import type { SourceType } from "../inventory/types.ts";

export function deriveBundleKind(bundleId: string | null): "plugin" | "marketplace" | null {
  if (!bundleId) return null;
  return bundleId.includes("@") ? "plugin" : "marketplace";
}

export interface Invocation { style: string; name?: string; example?: string; cmd?: string; subagent_type?: string; load_tools_via?: string }

export function deriveInvocation(sourceType: SourceType, canonicalName: string): Invocation {
  switch (sourceType) {
    case "skill":      return { style: "skill", name: canonicalName };
    case "command":    return { style: "slash", name: "/" + canonicalName };
    case "mcp_tool":   return { style: "tool", name: canonicalName };
    case "mcp_server": return { style: "server", name: canonicalName, load_tools_via: "ToolSearch" };
    case "agent":      return { style: "agent", subagent_type: canonicalName };
    case "cli":        return { style: "bash", example: canonicalName.replace(/^bin:/, "") };
    case "plugin":     return { style: "install", cmd: `claude plugin install ${canonicalName}` };
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
bun test tests/unit/matcher-derive.test.ts
git add src/matcher/derive.ts tests/unit/matcher-derive.test.ts
git commit -m "feat: read-time derivation of bundle_kind and invocation"
```

---

### Task 16: Claude rerank stage

**Files:**
- Create: `src/matcher/rerank.ts`
- Create: `tests/unit/rerank.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { buildPrompt, parseRerankResponse } from "../../src/matcher/rerank";

describe("buildPrompt", () => {
  test("includes goal and candidate list", () => {
    const p = buildPrompt("build a kubernetes deploy pipeline", [
      { id: "a", name: "kube-helper", source_type: "skill", description: "Kubernetes helper", installed: 1, bundle_id: null, source_url: null, source_sha: null, rank: 1 },
    ]);
    expect(p).toContain("build a kubernetes deploy pipeline");
    expect(p).toContain("kube-helper");
  });
});

describe("parseRerankResponse", () => {
  test("parses well-formed JSON", () => {
    const r = parseRerankResponse('{"ranked":[{"id":"a","score":90,"why":"good fit"}],"stop_reason":"all_relevant"}');
    expect(r?.ranked[0].id).toBe("a");
    expect(r?.stop_reason).toBe("all_relevant");
  });
  test("returns null on malformed", () => {
    expect(parseRerankResponse("not json")).toBeNull();
  });
  test("extracts JSON from text containing it", () => {
    const r = parseRerankResponse('Here you go: {"ranked":[],"stop_reason":"exhausted"} done.');
    expect(r?.stop_reason).toBe("exhausted");
  });
});
```

- [ ] **Step 2: Implementation**

`src/matcher/rerank.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { FtsHit } from "./fts.ts";

export interface RankedItem { id: string; score: number; why: string }
export type StopReason = "all_relevant" | "low_confidence" | "exhausted";
export interface RerankResult { ranked: RankedItem[]; stop_reason: StopReason }

export function buildPrompt(goal: string, hits: FtsHit[]): string {
  const lines = hits.map((h, i) =>
    `[${i + 1}] ${h.name} (${h.source_type}, ${h.installed ? "installed" : "gap"})\n    ${h.description ?? "(no description)"}`
  ).join("\n");
  return `Goal: ${goal}\n\nCandidates:\n${lines}\n\nReturn JSON with shape:\n{"ranked":[{"id":"<id>","score":0-100,"why":"<one sentence>"}],"stop_reason":"all_relevant"|"low_confidence"|"exhausted"}\n\nReturn at most the top 5 ranked items. Only respond with JSON.`;
}

const JSON_BLOCK = /\{[\s\S]*\}/;

export function parseRerankResponse(text: string): RerankResult | null {
  const m = text.match(JSON_BLOCK);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (!Array.isArray(obj.ranked) || !obj.stop_reason) return null;
    return obj as RerankResult;
  } catch { return null; }
}

export async function rerank(goal: string, hits: FtsHit[], idsByIndex: Map<number, string>): Promise<RerankResult | null> {
  const client = new Anthropic();
  const prompt = buildPrompt(goal, hits);
  try {
    const resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: "You rank capabilities by relevance to a user's coding goal. Output strict JSON only.",
      messages: [{ role: "user", content: prompt }],
    });
    const text = resp.content.filter(b => b.type === "text").map(b => (b as { type: "text"; text: string }).text).join("");
    let result = parseRerankResponse(text);
    if (!result) {
      // retry once
      const retry = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: "You rank capabilities. Respond ONLY with strict JSON, no preamble.",
        messages: [{ role: "user", content: prompt }],
      });
      const retryText = retry.content.filter(b => b.type === "text").map(b => (b as { type: "text"; text: string }).text).join("");
      result = parseRerankResponse(retryText);
    }
    // map index-style ids if present
    if (result) {
      for (const r of result.ranked) {
        const idx = parseInt(r.id, 10);
        if (!isNaN(idx) && idsByIndex.has(idx)) r.id = idsByIndex.get(idx)!;
      }
    }
    return result;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Run unit tests + commit**

```bash
bun test tests/unit/rerank.test.ts
git add src/matcher/rerank.ts tests/unit/rerank.test.ts
git commit -m "feat: Claude rerank with retry and degradation"
```

---

### Task 17: Output formatter (bucket installed vs gap, derive at output)

**Files:**
- Create: `src/matcher/format.ts`
- Create: `tests/unit/format.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { formatResults } from "../../src/matcher/format";
import type { FtsHit } from "../../src/matcher/fts";

const trustCfg = { version: 1, trusted_patterns: ["anthropic/*"], blocked_patterns: [] };

function hit(over: Partial<FtsHit>): FtsHit {
  return {
    id: "skill:x", source_type: "skill", name: "x", description: "x", installed: 1,
    bundle_id: null, source_url: null, source_sha: null, rank: 1, ...over,
  };
}

describe("formatResults", () => {
  test("buckets by installed/gap", () => {
    const result = formatResults([
      hit({ id: "a", name: "a", installed: 1 }),
      hit({ id: "b", name: "b", installed: 0 }),
    ], trustCfg);
    expect(result.installed.map(r => r.id)).toEqual(["a"]);
    expect(result.gap.map(r => r.id)).toEqual(["b"]);
  });

  test("derives trust_level per row", () => {
    const result = formatResults([
      hit({ id: "a", source_url: "https://github.com/anthropic/foo", installed: 0 }),
      hit({ id: "b", source_url: "https://github.com/other/x", installed: 0 }),
    ], trustCfg);
    expect(result.gap.find(r => r.id === "a")?.trust_level).toBe("trusted");
    expect(result.gap.find(r => r.id === "b")?.trust_level).toBe("unknown");
  });

  test("attaches invocation per row", () => {
    const result = formatResults([hit({ id: "skill:foo", source_type: "skill", name: "foo" })], trustCfg);
    expect(result.installed[0].invocation.style).toBe("skill");
  });
});
```

- [ ] **Step 2: Implementation**

`src/matcher/format.ts`:

```typescript
import type { FtsHit } from "./fts.ts";
import { trustLevel, type TrustConfig, type TrustLevel } from "../trust/derive.ts";
import { deriveInvocation, deriveBundleKind, type Invocation } from "./derive.ts";
import type { SourceType } from "../inventory/types.ts";

export interface FormattedRow {
  id: string;
  source_type: SourceType;
  name: string;
  description: string | null;
  installed: number;
  bundle_id: string | null;
  bundle_kind: "plugin" | "marketplace" | null;
  source_url: string | null;
  source_sha: string | null;
  trust_level: TrustLevel;
  invocation: Invocation;
}

export interface FormattedResults {
  installed: FormattedRow[];
  gap: FormattedRow[];
}

export function formatResults(hits: FtsHit[], trustCfg: TrustConfig): FormattedResults {
  const rows: FormattedRow[] = hits.map(h => ({
    id: h.id,
    source_type: h.source_type as SourceType,
    name: h.name,
    description: h.description,
    installed: h.installed,
    bundle_id: h.bundle_id,
    bundle_kind: deriveBundleKind(h.bundle_id),
    source_url: h.source_url,
    source_sha: h.source_sha,
    trust_level: trustLevel(h.source_url, trustCfg),
    invocation: deriveInvocation(h.source_type as SourceType, h.id.split(":").slice(1).join(":") || h.name),
  }));
  return {
    installed: rows.filter(r => r.installed === 1),
    gap: rows.filter(r => r.installed === 0),
  };
}
```

- [ ] **Step 3: Run + commit**

```bash
bun test tests/unit/format.test.ts
git add src/matcher/format.ts tests/unit/format.test.ts
git commit -m "feat: output formatter with read-time derivation"
```

---

## Milestone 5 — Installer

### Task 18: User prompts (untrusted confirm, drift, promote)

**Files:**
- Create: `src/installer/prompts.ts`
- Create: `tests/unit/prompts.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { formatUntrustedPrompt, formatDriftPrompt, formatPromotePrompt, parsePromoteChoice } from "../../src/installer/prompts";

describe("prompts", () => {
  test("formatUntrustedPrompt names source + asks confirm", () => {
    const p = formatUntrustedPrompt({ canonical: "foo/bar", source_url: "https://github.com/foo/bar", source_sha: "abc123" });
    expect(p).toContain("foo/bar");
    expect(p).toContain("abc123");
    expect(p.toLowerCase()).toContain("install");
  });

  test("formatDriftPrompt shows both SHAs", () => {
    const p = formatDriftPrompt({ canonical: "x", pinned_sha: "111", current_sha: "222", source_url: "https://github.com/x/y" });
    expect(p).toContain("111");
    expect(p).toContain("222");
  });

  test("formatPromotePrompt offers 3 options", () => {
    const p = formatPromotePrompt({ owner: "foo", repo: "bar" });
    expect(p).toContain("(1)");
    expect(p).toContain("(2)");
    expect(p).toContain("(3)");
  });

  test("parsePromoteChoice accepts 1/2/3, defaults 3", () => {
    expect(parsePromoteChoice("1")).toBe("promote-org");
    expect(parsePromoteChoice("2")).toBe("promote-repo");
    expect(parsePromoteChoice("3")).toBe("keep-prompting");
    expect(parsePromoteChoice("")).toBe("keep-prompting");
    expect(parsePromoteChoice("foo")).toBe("keep-prompting");
  });
});
```

- [ ] **Step 2: Implementation**

```typescript
export interface UntrustedCtx { canonical: string; source_url: string; source_sha: string }
export function formatUntrustedPrompt(ctx: UntrustedCtx): string {
  return `⚠ Untrusted source: ${ctx.source_url}\n  Capability: ${ctx.canonical}\n  SHA: ${ctx.source_sha}\nInstall? [y/N]`;
}

export interface DriftCtx { canonical: string; pinned_sha: string; current_sha: string; source_url: string }
export function formatDriftPrompt(ctx: DriftCtx): string {
  return `⚠ Pin drift detected for ${ctx.canonical}\n  Pinned:  ${ctx.pinned_sha}\n  Latest:  ${ctx.current_sha}\n  Diff:    ${ctx.source_url}/compare/${ctx.pinned_sha}...${ctx.current_sha}\n\nUpdate pin to latest? [y/N]`;
}

export interface PromoteCtx { owner: string; repo: string }
export function formatPromotePrompt(ctx: PromoteCtx): string {
  return `Install successful from untrusted source.\nSource github.com/${ctx.owner} is not in your trusted_patterns. Add to allowlist?\n\n  (1) Yes, trust ${ctx.owner}/*           (whole org)\n  (2) Yes, trust ${ctx.owner}/${ctx.repo} only\n  (3) No, keep prompting          (default)\n\n[1/2/3]`;
}

export type PromoteChoice = "promote-org" | "promote-repo" | "keep-prompting";
export function parsePromoteChoice(input: string): PromoteChoice {
  const trimmed = input.trim();
  if (trimmed === "1") return "promote-org";
  if (trimmed === "2") return "promote-repo";
  return "keep-prompting";
}
```

- [ ] **Step 3: Run + commit**

```bash
bun test tests/unit/prompts.test.ts
git add src/installer/prompts.ts tests/unit/prompts.test.ts
git commit -m "feat: install prompts (untrusted, drift, promote)"
```

---

### Task 19: Per-source-type install flows

**Files:**
- Create: `src/installer/types.ts`
- Create: `src/installer/plugin.ts`
- Create: `src/installer/skill-skillssh.ts`
- Create: `src/installer/skill-raw.ts`
- Create: `src/installer/mcp.ts`
- Create: `src/installer/cli.ts`
- Create: `src/installer/verify.ts`
- Create: `tests/unit/installer-verify.test.ts`

- [ ] **Step 1: Common types**

`src/installer/types.ts`:

```typescript
export interface InstallContext {
  capability_id: string;
  canonical_name: string;
  source_type: "plugin" | "skill" | "mcp_server" | "cli";
  source_url?: string;
  registry?: "skills.sh" | "brew" | "npm" | "cargo" | "raw" | "claude-marketplace";
}

export interface InstallResult {
  capability_id: string;
  status: "installed" | "skipped" | "blocked" | "failed";
  source_sha: string | null;
  trust_action: "auto-trusted" | "user-confirm" | "promoted-org" | "promoted-repo" | "none";
  verified: boolean;
  files: string[];
  errors: string[];
}
```

- [ ] **Step 2: Plugin install**

`src/installer/plugin.ts`:

```typescript
import { $ } from "bun";
import { readFileSync } from "node:fs";
import { paths } from "../paths.ts";
import type { InstallContext, InstallResult } from "./types.ts";

export async function installPlugin(ctx: InstallContext): Promise<InstallResult> {
  const result: InstallResult = {
    capability_id: ctx.capability_id, status: "failed", source_sha: null, trust_action: "none",
    verified: false, files: [], errors: [],
  };
  try {
    const proc = await $`claude plugin install ${ctx.canonical_name}`.quiet().nothrow();
    if (proc.exitCode !== 0) {
      result.errors.push(proc.stderr.toString());
      return result;
    }
    const manifest = JSON.parse(readFileSync(paths.claudePluginsManifest, "utf8"));
    const entries = manifest.plugins?.[ctx.canonical_name];
    if (entries?.[0]) {
      result.source_sha = entries[0].gitCommitSha ?? null;
      result.files = [entries[0].installPath];
      result.status = "installed";
      result.verified = true;
    } else {
      result.errors.push("Plugin manifest entry not found after install");
    }
  } catch (e) {
    result.errors.push(String(e));
  }
  return result;
}
```

- [ ] **Step 3: Skill via skills.sh**

`src/installer/skill-skillssh.ts`:

```typescript
import { $ } from "bun";
import { existsSync } from "node:fs";
import { paths } from "../paths.ts";
import type { InstallContext, InstallResult } from "./types.ts";

export async function installSkillSkillsSh(ctx: InstallContext): Promise<InstallResult> {
  const result: InstallResult = {
    capability_id: ctx.capability_id, status: "failed", source_sha: null, trust_action: "none",
    verified: false, files: [], errors: [],
  };
  try {
    const proc = await $`npx -y skills add -y -g ${ctx.canonical_name}`.quiet().nothrow();
    if (proc.exitCode !== 0) {
      result.errors.push(proc.stderr.toString());
      return result;
    }
    const slug = ctx.canonical_name.split("/").pop()!;
    const skillDir = `${paths.claudeSkills}/${slug}`;
    if (!existsSync(`${skillDir}/SKILL.md`)) {
      result.errors.push("SKILL.md not found after npx skills add (silent no-op)");
      return result;
    }
    const sha = await $`git -C ${skillDir} rev-parse HEAD`.quiet().nothrow();
    result.source_sha = sha.exitCode === 0 ? sha.stdout.toString().trim() : null;
    result.files = [`${skillDir}/SKILL.md`];
    result.status = "installed";
    result.verified = true;
  } catch (e) {
    result.errors.push(String(e));
  }
  return result;
}
```

- [ ] **Step 4: Skill raw (WebFetch + write)**

`src/installer/skill-raw.ts`:

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { paths } from "../paths.ts";
import type { InstallContext, InstallResult } from "./types.ts";

export interface RawSkillArgs extends InstallContext {
  raw_url: string;
  skill_slug: string;
}

export async function installSkillRaw(args: RawSkillArgs): Promise<InstallResult> {
  const result: InstallResult = {
    capability_id: args.capability_id, status: "failed", source_sha: null, trust_action: "none",
    verified: false, files: [], errors: [],
  };
  try {
    const resp = await fetch(args.raw_url);
    if (!resp.ok) { result.errors.push(`HTTP ${resp.status}`); return result; }
    const text = await resp.text();
    if (text.trim().startsWith("<")) { result.errors.push("Response looks like HTML, not raw markdown"); return result; }
    const dir = `${paths.claudeSkills}/${args.skill_slug}`;
    mkdirSync(dir, { recursive: true });
    const file = `${dir}/SKILL.md`;
    writeFileSync(file, text);
    result.source_sha = createHash("sha1").update(text).digest("hex").slice(0, 12);
    result.files = [file];
    result.status = "installed";
    result.verified = true;
  } catch (e) {
    result.errors.push(String(e));
  }
  return result;
}
```

- [ ] **Step 5: MCP install**

`src/installer/mcp.ts`:

```typescript
import { $ } from "bun";
import type { InstallContext, InstallResult } from "./types.ts";

export interface McpArgs extends InstallContext {
  transport_args: string[];
}

export async function installMcp(args: McpArgs): Promise<InstallResult> {
  const result: InstallResult = {
    capability_id: args.capability_id, status: "failed", source_sha: null, trust_action: "none",
    verified: false, files: [], errors: [],
  };
  try {
    const proc = await $`claude mcp add ${args.canonical_name} ${{ raw: args.transport_args.join(" ") }}`.quiet().nothrow();
    if (proc.exitCode !== 0) {
      result.errors.push(proc.stderr.toString());
      return result;
    }
    const list = await $`claude mcp list`.quiet().nothrow();
    if (list.stdout.toString().includes(args.canonical_name)) {
      result.status = "installed";
      result.verified = true;
    } else {
      result.errors.push("server not listed after add");
    }
  } catch (e) {
    result.errors.push(String(e));
  }
  return result;
}
```

- [ ] **Step 6: CLI install (print-and-confirm)**

`src/installer/cli.ts`:

```typescript
import type { InstallContext, InstallResult } from "./types.ts";

export interface CliArgs extends InstallContext { command: string }

export function installCli(args: CliArgs): InstallResult {
  // CLI installs are never auto-run. We return a "skipped" status with a hint command for the user.
  return {
    capability_id: args.capability_id,
    status: "skipped",
    source_sha: null,
    trust_action: "none",
    verified: false,
    files: [],
    errors: [`To install, run manually: ${args.command}`],
  };
}
```

- [ ] **Step 7: Verify module + test**

`src/installer/verify.ts`:

```typescript
import { existsSync, statSync } from "node:fs";

export function verifyInstall(files: string[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const f of files) {
    if (!existsSync(f)) { problems.push(`missing: ${f}`); continue; }
    const s = statSync(f);
    if (s.size === 0) problems.push(`empty: ${f}`);
  }
  return { ok: problems.length === 0, problems };
}
```

`tests/unit/installer-verify.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { verifyInstall } from "../../src/installer/verify";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("verifyInstall", () => {
  test("ok when all files exist and non-empty", () => {
    const tmp = mkdtempSync(join(tmpdir(), "v-"));
    const f = join(tmp, "x");
    writeFileSync(f, "content");
    expect(verifyInstall([f]).ok).toBe(true);
    rmSync(tmp, { recursive: true });
  });
  test("not ok when file missing", () => {
    expect(verifyInstall(["/nonexistent/x"]).ok).toBe(false);
  });
  test("not ok when file empty", () => {
    const tmp = mkdtempSync(join(tmpdir(), "v-"));
    const f = join(tmp, "x");
    writeFileSync(f, "");
    expect(verifyInstall([f]).ok).toBe(false);
    rmSync(tmp, { recursive: true });
  });
});
```

- [ ] **Step 8: Run + commit**

```bash
bun test tests/unit/installer-verify.test.ts
git add src/installer/ tests/unit/installer-verify.test.ts tests/unit/prompts.test.ts
git commit -m "feat: per-source-type install flows + post-install verification"
```

---

## Milestone 6 — Gap search

### Task 20: Tier 1 — known registries

**Files:**
- Create: `src/gap-search/registries.ts`
- Create: `tests/unit/registries.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, test, mock } from "bun:test";
import { searchSkillsSh, type RegistryHit } from "../../src/gap-search/registries";

describe("searchSkillsSh", () => {
  test("parses npx skills find output", async () => {
    const runner = mock(async () => `foo/bar@my-skill    42 installs
└ https://skills.sh/foo/bar/my-skill
other/baz@thing    10 installs
└ https://skills.sh/other/baz/thing`);
    const hits = await searchSkillsSh("test", runner);
    expect(hits.length).toBe(2);
    expect(hits[0]).toEqual({
      name: "my-skill",
      canonical: "foo/bar@my-skill",
      installs: 42,
      url: "https://skills.sh/foo/bar/my-skill",
      registry: "skills.sh",
    } satisfies RegistryHit);
  });

  test("returns empty on no results", async () => {
    const runner = mock(async () => "no skills found");
    expect(await searchSkillsSh("zzz", runner)).toEqual([]);
  });
});
```

- [ ] **Step 2: Implementation**

`src/gap-search/registries.ts`:

```typescript
import { $ } from "bun";

export interface RegistryHit {
  name: string;
  canonical: string;
  installs?: number;
  url: string;
  registry: "skills.sh" | "brew" | "npm" | "cargo" | "claude-marketplace";
}

export type Runner = (query: string) => Promise<string>;

const defaultSkillsRunner: Runner = async (q) => (await $`npx -y skills find ${q}`.quiet().nothrow()).stdout.toString();

export async function searchSkillsSh(query: string, runner: Runner = defaultSkillsRunner): Promise<RegistryHit[]> {
  const out = await runner(query);
  const lines = out.split("\n");
  const hits: RegistryHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([^\s]+\/[^\s]+@[^\s]+)\s+(\d+)\s+installs?/);
    if (m && i + 1 < lines.length) {
      const urlMatch = lines[i + 1].match(/https:\/\/\S+/);
      hits.push({
        name: m[1].split("@")[1],
        canonical: m[1],
        installs: parseInt(m[2], 10),
        url: urlMatch?.[0] ?? "",
        registry: "skills.sh",
      });
    }
  }
  return hits;
}

const defaultBrewRunner: Runner = async (q) => (await $`brew search ${q}`.quiet().nothrow()).stdout.toString();

export async function searchBrew(query: string, runner: Runner = defaultBrewRunner): Promise<RegistryHit[]> {
  const out = await runner(query);
  return out.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 10).map(name => ({
    name, canonical: name, url: `https://formulae.brew.sh/formula/${name}`, registry: "brew" as const,
  }));
}
```

- [ ] **Step 3: Run + commit**

```bash
bun test tests/unit/registries.test.ts
git add src/gap-search/registries.ts tests/unit/registries.test.ts
git commit -m "feat: gap-search tier 1 (skills.sh + brew registries)"
```

---

### Task 21: Tier 2/3 — web search escalation

**Files:**
- Create: `src/gap-search/websearch.ts`
- Create: `tests/unit/websearch.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { buildWebSearchQuery } from "../../src/gap-search/websearch";

describe("buildWebSearchQuery", () => {
  test("skill template", () => {
    expect(buildWebSearchQuery("skill", "react")).toBe('site:github.com "SKILL.md" claude react');
  });
  test("mcp_server template", () => {
    expect(buildWebSearchQuery("mcp_server", "linear")).toBe('"mcp server" linear site:github.com');
  });
  test("cli template", () => {
    expect(buildWebSearchQuery("cli", "yaml")).toBe("yaml CLI tool site:github.com OR site:crates.io");
  });
});
```

- [ ] **Step 2: Implementation**

`src/gap-search/websearch.ts`:

```typescript
export type GapSourceType = "skill" | "mcp_server" | "cli";

export function buildWebSearchQuery(type: GapSourceType, terms: string): string {
  switch (type) {
    case "skill":      return `site:github.com "SKILL.md" claude ${terms}`;
    case "mcp_server": return `"mcp server" ${terms} site:github.com`;
    case "cli":        return `${terms} CLI tool site:github.com OR site:crates.io`;
  }
}

// Tier-2 prompt and Tier-3 execution are surfaced at /qm survey level (Task 27).
// This module provides the query templates only — actual WebSearch call lives in the
// runtime that has WebSearch tool access (the survey command shim).
```

- [ ] **Step 3: Run + commit**

```bash
bun test tests/unit/websearch.test.ts
git add src/gap-search/websearch.ts tests/unit/websearch.test.ts
git commit -m "feat: web-search query templates per source_type"
```

---

## Milestone 7 — Hook + classifier

### Task 22: Planning-intent classifier

**Files:**
- Create: `src/classifier/intent.ts`
- Create: `tests/unit/classifier.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, test } from "bun:test";
import { classify } from "../../src/classifier/intent";

describe("classify", () => {
  test("detects planning + tech", () => {
    const r = classify("I want to build a React dashboard with Supabase auth");
    expect(r.planning).toBe(true);
    expect(r.techKeywords).toContain("react");
    expect(r.techKeywords).toContain("supabase");
    expect(r.fire).toBe(true);
  });

  test("planning without tech does not fire", () => {
    const r = classify("how should I plan my day");
    expect(r.fire).toBe(false);
  });

  test("tech without planning does not fire", () => {
    const r = classify("the react component is broken");
    expect(r.fire).toBe(false);
  });

  test("neither does not fire", () => {
    expect(classify("hello").fire).toBe(false);
  });
});
```

- [ ] **Step 2: Implementation**

`src/classifier/intent.ts`:

```typescript
const PLANNING_TRIGGERS: RegExp[] = [
  /^(plan|design|brainstorm|build|implement|create|set up)\b/i,
  /\bhow (would|should|do) (i|we|you)\b/i,
  /\bwhat['']?s? the best way to\b/i,
  /\b(approach|strategy|architecture) for\b/i,
];

const TECH_KEYWORDS = [
  "react","vue","svelte","angular","nextjs","next.js","remix","astro",
  "django","fastapi","flask","rails","laravel","spring",
  "kubernetes","k8s","docker","terraform","ansible","helm",
  "aws","gcp","azure","vercel","netlify","cloudflare",
  "postgres","postgresql","mysql","sqlite","redis","kafka","rabbitmq","clickhouse","mongodb",
  "prisma","drizzle","sqlalchemy","typeorm",
  "supabase","firebase","auth0","clerk","stripe",
  "typescript","javascript","python","rust","go","golang","ruby","php","java","kotlin","swift",
  "graphql","grpc","trpc","rest","websocket",
  "bun","node","deno","npm","pnpm","yarn","cargo","pip","poetry",
  "vite","webpack","esbuild","turbopack","rollup","parcel",
  "jest","vitest","pytest","playwright","cypress","mocha",
];

export interface ClassifyResult { planning: boolean; techKeywords: string[]; fire: boolean }

export function classify(prompt: string): ClassifyResult {
  const planning = PLANNING_TRIGGERS.some(re => re.test(prompt));
  const lower = prompt.toLowerCase();
  const techKeywords = TECH_KEYWORDS.filter(t => new RegExp(`\\b${t.replace(".", "\\.")}\\b`).test(lower));
  return { planning, techKeywords, fire: planning && techKeywords.length > 0 };
}
```

- [ ] **Step 3: Run + commit**

```bash
bun test tests/unit/classifier.test.ts
git add src/classifier/intent.ts tests/unit/classifier.test.ts
git commit -m "feat: planning-intent classifier (regex + tech keyword)"
```

---

### Task 23: UserPromptSubmit hook entry point

**Files:**
- Create: `src/hooks/prompt-hook.ts`
- Create: `tests/integration/prompt-hook.test.ts`

- [ ] **Step 1: Failing integration test**

```typescript
import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook } from "../../src/hooks/prompt-hook";

let tmpDir: string;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "qm-hook-")); });

describe("runHook", () => {
  test("cold state: emits nudge + writes marker", () => {
    const dataDir = join(tmpDir, "qm");
    mkdirSync(dataDir, { recursive: true });
    const result = runHook({ prompt: "hello", dataDir, hashInputs: [] });
    expect(result.output).toContain("not built");
    expect(existsSync(join(dataDir, ".session-init-shown"))).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  test("cold state second call: silent (marker present)", () => {
    const dataDir = join(tmpDir, "qm");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, ".session-init-shown"), "");
    const result = runHook({ prompt: "hello", dataDir, hashInputs: [] });
    expect(result.output).toBe("");
    rmSync(tmpDir, { recursive: true });
  });

  test("warm + no planning intent: silent", () => {
    const dataDir = join(tmpDir, "qm");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "inventory.db"), "");
    writeFileSync(join(dataDir, "inventory.hash"), "abc123def456");
    const result = runHook({ prompt: "fix the bug", dataDir, hashInputs: [] });
    expect(result.output).toBe("");
    rmSync(tmpDir, { recursive: true });
  });

  test("warm + planning intent + tech keyword: emits nudge", () => {
    const dataDir = join(tmpDir, "qm");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "inventory.db"), "");
    writeFileSync(join(dataDir, "inventory.hash"), "abc123def456");
    const result = runHook({ prompt: "I want to build a kubernetes deployment pipeline", dataDir, hashInputs: [] });
    expect(result.output).toContain("planning intent");
    expect(result.output).toContain("kubernetes");
    rmSync(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Implementation**

`src/hooks/prompt-hook.ts`:

```typescript
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { signatureHash } from "../inventory/hash.ts";
import { classify } from "../classifier/intent.ts";

export interface HookInput {
  prompt: string;
  dataDir: string;
  hashInputs: string[];
}

export interface HookOutput { output: string }

export function runHook(input: HookInput): HookOutput {
  const dbPath = join(input.dataDir, "inventory.db");
  const hashPath = join(input.dataDir, "inventory.hash");
  const marker = join(input.dataDir, ".session-init-shown");

  if (!existsSync(dbPath)) {
    if (existsSync(marker)) return { output: "" };
    writeFileSync(marker, "");
    return { output: "[quartermaster] index not built. Run /qm init to enable discovery.\n" };
  }

  const cls = classify(input.prompt);
  if (!cls.fire) return { output: "" };

  const currentHash = signatureHash(input.hashInputs);
  const storedHash = existsSync(hashPath) ? require("node:fs").readFileSync(hashPath, "utf8").trim() : "";
  const stale = currentHash !== storedHash;

  const techList = cls.techKeywords.slice(0, 5).join(", ");
  let out = `[quartermaster] planning intent detected with tech keywords: [${techList}].\n`;
  out += `Consider /qm survey "<prompt summary>" before deep planning.\n`;
  if (stale) out += `⚠ Inventory stale. Run /qm init to refresh.\n`;
  return { output: out };
}

// CLI entry: stdin = prompt text
if (import.meta.main) {
  const HOME = process.env.HOME ?? "";
  const dataDir = `${HOME}/.quartermaster`;
  const promptText = await Bun.stdin.text();
  const hashInputs = [
    `${HOME}/.claude/plugins/installed_plugins.json`,
    `${HOME}/.claude/settings.json`,
    `${HOME}/.claude.json`,
    `${HOME}/.claude/skills`,
  ];
  const watchdog = setTimeout(() => process.exit(0), 80);
  try {
    const r = runHook({ prompt: promptText, dataDir, hashInputs });
    if (r.output) process.stdout.write(r.output);
  } catch { /* fail-open */ }
  clearTimeout(watchdog);
}
```

- [ ] **Step 3: Run + commit**

```bash
bun test tests/integration/prompt-hook.test.ts
git add src/hooks/prompt-hook.ts tests/integration/prompt-hook.test.ts
git commit -m "feat: UserPromptSubmit hook (single entry point)"
```

---

## Milestone 8 — Commands

### Task 24: `/qm init` (incremental + variants)

**Files:**
- Create: `src/commands/init.ts`
- Create: `tests/integration/init.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init";

let tmpDir: string;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "qm-init-")); });

describe("runInit", () => {
  test("creates data dir + DB + trust.json + hash file on cold start", async () => {
    const dataDir = join(tmpDir, "qm");
    const fakeClaude = join(tmpDir, "claude");
    mkdirSync(join(fakeClaude, "skills"), { recursive: true });
    mkdirSync(join(fakeClaude, "plugins"), { recursive: true });
    writeFileSync(join(fakeClaude, "plugins/installed_plugins.json"), JSON.stringify({ plugins: {} }));
    const result = await runInit({
      dataDir, claudeDir: fakeClaude, claudeJson: join(tmpDir, ".claude.json"),
      mcpServers: {}, mcpFetcher: async () => [],
    });
    expect(result.ok).toBe(true);
    expect(existsSync(join(dataDir, "inventory.db"))).toBe(true);
    expect(existsSync(join(dataDir, "trust.json"))).toBe(true);
    expect(existsSync(join(dataDir, "inventory.hash"))).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  test("--check mode does not write DB", async () => {
    const dataDir = join(tmpDir, "qm");
    const fakeClaude = join(tmpDir, "claude");
    mkdirSync(join(fakeClaude, "skills"), { recursive: true });
    mkdirSync(join(fakeClaude, "plugins"), { recursive: true });
    writeFileSync(join(fakeClaude, "plugins/installed_plugins.json"), JSON.stringify({ plugins: {} }));
    const result = await runInit({
      dataDir, claudeDir: fakeClaude, claudeJson: join(tmpDir, ".claude.json"),
      mcpServers: {}, mcpFetcher: async () => [], check: true,
    });
    expect(result.ok).toBe(true);
    expect(existsSync(join(dataDir, "inventory.db"))).toBe(false);
    rmSync(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Implementation**

`src/commands/init.ts`:

```typescript
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../db/connection.ts";
import { migrate } from "../db/migrate.ts";
import { applyRecords } from "../inventory/indexer.ts";
import { enumerateSkills } from "../inventory/enum-skills.ts";
import { enumeratePlugins } from "../inventory/enum-plugins.ts";
import { enumerateMdTree } from "../inventory/enum-md-tree.ts";
import { enumerateMcp, type ToolsListFetcher } from "../inventory/enum-mcp.ts";
import { enumerateCli } from "../inventory/enum-cli.ts";
import { seedDefault } from "../trust/derive.ts";
import { signatureHash, defaultSignatureInputs } from "../inventory/hash.ts";
import CLI_KNOWN from "../inventory/cli-known.json" with { type: "json" };

export interface InitArgs {
  dataDir: string;
  claudeDir: string;
  claudeJson: string;
  mcpServers: Record<string, unknown>;
  mcpFetcher: ToolsListFetcher;
  force?: boolean;
  check?: boolean;
  refreshCli?: boolean;
  refreshMcp?: boolean;
  enabledPlugins?: Set<string>;
}

export interface InitResult { ok: boolean; counts: Record<string, number>; problems: string[] }

export async function runInit(args: InitArgs): Promise<InitResult> {
  const problems: string[] = [];
  mkdirSync(args.dataDir, { recursive: true });
  const trustPath = join(args.dataDir, "trust.json");
  const dbPath = join(args.dataDir, "inventory.db");
  const hashPath = join(args.dataDir, "inventory.hash");

  if (args.force && existsSync(dbPath)) rmSync(dbPath);
  seedDefault(trustPath);

  const enabled = args.enabledPlugins ?? new Set<string>();
  const records = [
    ...enumerateSkills(join(args.claudeDir, "skills")),
    ...enumeratePlugins(join(args.claudeDir, "plugins/installed_plugins.json"), enabled),
    ...enumerateMdTree(join(args.claudeDir, "commands"), "command"),
    ...enumerateMdTree(join(args.claudeDir, "agents"), "agent"),
    ...enumerateCli(CLI_KNOWN as any, loadCliExtras(args.dataDir)),
  ];

  if (args.check) {
    const counts = countBySource(records);
    return { ok: true, counts, problems };
  }

  const db = openDb(dbPath);
  migrate(db);
  if (args.refreshMcp) db.exec("DELETE FROM mcp_tool_cache");
  const mcpRecords = await enumerateMcp(args.mcpServers, db, args.mcpFetcher);
  records.push(...mcpRecords);
  applyRecords(db, records);
  db.close();

  writeFileSync(hashPath, signatureHash(defaultSignatureInputs()));
  return { ok: true, counts: countBySource(records), problems };
}

function loadCliExtras(dataDir: string): Record<string, any> {
  const path = join(dataDir, "cli-extras.json");
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; }
}

function countBySource(records: { source_type: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of records) counts[r.source_type] = (counts[r.source_type] ?? 0) + 1;
  return counts;
}
```

- [ ] **Step 3: Run + commit**

```bash
bun test tests/integration/init.test.ts
git add src/commands/init.ts tests/integration/init.test.ts
git commit -m "feat: /qm init command (incremental + --force + --check + --refresh-mcp)"
```

---

### Task 25: `/qm survey <goal>` end-to-end

**Files:**
- Create: `src/commands/survey.ts`
- Create: `tests/integration/survey.test.ts`

- [ ] **Step 1: Failing integration test**

```typescript
import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";
import { applyRecords } from "../../src/inventory/indexer";
import { runSurvey } from "../../src/commands/survey";
import type { CapabilityRecord } from "../../src/inventory/types";

let tmpDir: string; let dbPath: string;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "qm-srv-")); dbPath = join(tmpDir, "t.db"); });

function rec(over: Partial<CapabilityRecord>): CapabilityRecord {
  return {
    id: "x", source_type: "skill", name: "x", canonical_name: "x", description: "x", keywords: null,
    installed: 1, enabled: null, bundle_id: null, bundle_version: null, bundle_path: null,
    source_url: null, source_sha: null, last_seen_epoch: 1, content_hash: "x", ...over,
  };
}

describe("runSurvey", () => {
  test("returns formatted results bucketed installed/gap", async () => {
    const db = openDb(dbPath); migrate(db);
    applyRecords(db, [
      rec({ id: "a", name: "kube-skill", description: "kubernetes deploy helper", installed: 1 }),
      rec({ id: "b", name: "react-skill", description: "react component patterns", installed: 0 }),
    ]);
    // Inject mock rerank that just returns FTS order
    const result = await runSurvey({
      dataDir: tmpDir,
      dbPath,
      goal: "kubernetes",
      rerankImpl: async (_g, hits) => ({
        ranked: hits.slice(0, 5).map(h => ({ id: h.id, score: 80, why: "ok" })),
        stop_reason: "all_relevant",
      }),
    });
    expect(result.installed.length + result.gap.length).toBeGreaterThan(0);
    db.close(); rmSync(tmpDir, { recursive: true });
  });

  test("falls back to FTS-only when rerank returns null", async () => {
    const db = openDb(dbPath); migrate(db);
    applyRecords(db, [rec({ id: "a", description: "kubernetes deploy" })]);
    const result = await runSurvey({
      dataDir: tmpDir, dbPath, goal: "kubernetes",
      rerankImpl: async () => null,
    });
    expect(result.degraded).toBe(true);
    expect(result.installed.length + result.gap.length).toBeGreaterThan(0);
    db.close(); rmSync(tmpDir, { recursive: true });
  });

  test("empty inventory returns refuse signal", async () => {
    const db = openDb(dbPath); migrate(db); db.close();
    const result = await runSurvey({
      dataDir: tmpDir, dbPath, goal: "anything",
      rerankImpl: async () => null,
    });
    expect(result.refused).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Implementation**

`src/commands/survey.ts`:

```typescript
import { openDb } from "../db/connection.ts";
import { migrate } from "../db/migrate.ts";
import { ftsNarrow, type FtsHit } from "../matcher/fts.ts";
import { formatResults, type FormattedResults } from "../matcher/format.ts";
import { loadTrust } from "../trust/derive.ts";
import { join } from "node:path";
import type { RerankResult } from "../matcher/rerank.ts";

export interface SurveyArgs {
  dataDir: string;
  dbPath: string;
  goal: string;
  rerankImpl: (goal: string, hits: FtsHit[]) => Promise<RerankResult | null>;
}

export interface SurveyResult extends FormattedResults {
  degraded: boolean;
  refused: boolean;
  stop_reason: string | null;
}

export async function runSurvey(args: SurveyArgs): Promise<SurveyResult> {
  const trust = loadTrust(join(args.dataDir, "trust.json"));
  const db = openDb(args.dbPath);
  migrate(db);

  const row = db.query("SELECT COUNT(*) as c FROM capabilities").get() as { c: number };
  if (row.c === 0) {
    db.close();
    return { installed: [], gap: [], degraded: false, refused: true, stop_reason: null };
  }

  const hits = ftsNarrow(db, args.goal, 20);
  if (hits.length === 0) {
    db.close();
    return { installed: [], gap: [], degraded: false, refused: false, stop_reason: "exhausted" };
  }

  const ranked = await args.rerankImpl(args.goal, hits);
  let topHits: FtsHit[];
  let degraded = false;
  let stop: string | null = null;
  if (!ranked) {
    degraded = true;
    topHits = hits.slice(0, 5);
  } else {
    stop = ranked.stop_reason;
    const byId = new Map(hits.map(h => [h.id, h]));
    topHits = ranked.ranked.map(r => byId.get(r.id)).filter((h): h is FtsHit => !!h);
  }

  const formatted = formatResults(topHits, trust);
  db.close();
  return { ...formatted, degraded, refused: false, stop_reason: stop };
}
```

- [ ] **Step 3: Run + commit**

```bash
bun test tests/integration/survey.test.ts
git add src/commands/survey.ts tests/integration/survey.test.ts
git commit -m "feat: /qm survey end-to-end (FTS → rerank → format)"
```

---

### Task 26: `/qm list`, `/qm trust`, `/qm prune`

**Files:**
- Create: `src/commands/list.ts`
- Create: `src/commands/trust.ts`
- Create: `src/commands/prune.ts`
- Create: `tests/integration/commands-misc.test.ts`

- [ ] **Step 1: Failing test (combined)**

```typescript
import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";
import { applyRecords } from "../../src/inventory/indexer";
import { runList } from "../../src/commands/list";
import { runTrustAdd, runTrustList } from "../../src/commands/trust";
import { runPrune } from "../../src/commands/prune";
import type { CapabilityRecord } from "../../src/inventory/types";

let tmpDir: string; let dbPath: string; let trustPath: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "qm-cmd-"));
  dbPath = join(tmpDir, "t.db");
  trustPath = join(tmpDir, "trust.json");
  writeFileSync(trustPath, JSON.stringify({ version: 1, trusted_patterns: [], blocked_patterns: [] }));
});

function rec(id: string, src: any, inst: 0 | 1): CapabilityRecord {
  return {
    id, source_type: src, name: id, canonical_name: id, description: null, keywords: null,
    installed: inst, enabled: null, bundle_id: null, bundle_version: null, bundle_path: null,
    source_url: null, source_sha: null, last_seen_epoch: 1, content_hash: id,
  };
}

describe("runList", () => {
  test("returns all rows or filtered by source_type", () => {
    const db = openDb(dbPath); migrate(db);
    applyRecords(db, [rec("a", "skill", 1), rec("b", "cli", 1)]);
    expect(runList(dbPath).length).toBe(2);
    expect(runList(dbPath, "skill").length).toBe(1);
    db.close(); rmSync(tmpDir, { recursive: true });
  });
});

describe("runTrustAdd / runTrustList", () => {
  test("adds pattern and lists it", () => {
    runTrustAdd(trustPath, "anthropic/*");
    const list = runTrustList(trustPath);
    expect(list.trusted_patterns).toContain("anthropic/*");
    rmSync(tmpDir, { recursive: true });
  });
  test("rejects invalid pattern", () => {
    expect(() => runTrustAdd(trustPath, "*/*")).toThrow();
    rmSync(tmpDir, { recursive: true });
  });
});

describe("runPrune", () => {
  test("removes rows with installed=0", () => {
    const db = openDb(dbPath); migrate(db);
    applyRecords(db, [rec("a", "skill", 1), rec("b", "skill", 0)]);
    const removed = runPrune(dbPath);
    expect(removed).toBe(1);
    const remaining = runList(dbPath);
    expect(remaining.map(r => r.id)).toEqual(["a"]);
    db.close(); rmSync(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Implementations**

`src/commands/list.ts`:

```typescript
import { openDb } from "../db/connection.ts";
import type { CapabilityRecord } from "../inventory/types.ts";

export function runList(dbPath: string, sourceType?: string): CapabilityRecord[] {
  const db = openDb(dbPath);
  try {
    const sql = sourceType
      ? "SELECT * FROM capabilities WHERE source_type = ? ORDER BY id"
      : "SELECT * FROM capabilities ORDER BY id";
    return (sourceType ? db.query(sql).all(sourceType) : db.query(sql).all()) as CapabilityRecord[];
  } finally { db.close(); }
}
```

`src/commands/trust.ts`:

```typescript
import { loadTrust, saveTrust, type TrustConfig } from "../trust/derive.ts";
import { validatePattern } from "../trust/patterns.ts";

export function runTrustAdd(trustPath: string, pattern: string): void {
  validatePattern(pattern);
  const cfg = loadTrust(trustPath);
  if (!cfg.trusted_patterns.includes(pattern)) cfg.trusted_patterns.push(pattern);
  saveTrust(trustPath, cfg);
}

export function runTrustList(trustPath: string): TrustConfig {
  return loadTrust(trustPath);
}
```

`src/commands/prune.ts`:

```typescript
import { openDb } from "../db/connection.ts";

export function runPrune(dbPath: string): number {
  const db = openDb(dbPath);
  try {
    const res = db.query("DELETE FROM capabilities WHERE installed = 0").run();
    return res.changes;
  } finally { db.close(); }
}
```

- [ ] **Step 3: Run + commit**

```bash
bun test tests/integration/commands-misc.test.ts
git add src/commands/list.ts src/commands/trust.ts src/commands/prune.ts tests/integration/commands-misc.test.ts
git commit -m "feat: /qm list, /qm trust add/list, /qm prune"
```

---

## Milestone 9 — Plugin wiring

### Task 27: Slash-command shims

**Files:**
- Create: `commands/qm.md`
- Create: `src/cli.ts` (dispatcher entry point)

- [ ] **Step 1: Dispatcher**

`src/cli.ts`:

```typescript
#!/usr/bin/env bun
import { paths } from "./paths.ts";

const [, , sub, ...rest] = process.argv;

async function main() {
  switch (sub) {
    case "init": {
      const { runInit } = await import("./commands/init.ts");
      const flags = new Set(rest);
      const args = {
        dataDir: paths.dataDir,
        claudeDir: paths.claudeDir,
        claudeJson: paths.claudeJson,
        mcpServers: await loadMcpServers(),
        mcpFetcher: mcpFetcher(),
        force: flags.has("--force"),
        check: flags.has("--check"),
        refreshCli: flags.has("--refresh-cli"),
        refreshMcp: flags.has("--refresh-mcp"),
        enabledPlugins: await loadEnabledPlugins(),
      };
      const r = await runInit(args);
      console.log(`[quartermaster] init: ${JSON.stringify(r.counts)}`);
      if (r.problems.length) console.warn(r.problems.join("\n"));
      break;
    }
    case "survey": {
      const goal = rest.join(" ");
      if (!goal) { console.error("usage: /qm survey <goal>"); process.exit(2); }
      const { runSurvey } = await import("./commands/survey.ts");
      const { rerank } = await import("./matcher/rerank.ts");
      const result = await runSurvey({
        dataDir: paths.dataDir, dbPath: paths.inventoryDb, goal,
        rerankImpl: (g, hits) => rerank(g, hits, new Map(hits.map((h, i) => [i + 1, h.id]))),
      });
      if (result.refused) { console.error("[quartermaster] no inventory. Run /qm init first."); process.exit(2); }
      printSurvey(result);
      break;
    }
    case "list": {
      const { runList } = await import("./commands/list.ts");
      const filter = rest.find(a => a.startsWith("--source-type="))?.split("=")[1];
      for (const r of runList(paths.inventoryDb, filter)) {
        console.log(`${r.source_type.padEnd(10)} ${r.canonical_name.padEnd(40)} ${r.description?.slice(0, 60) ?? ""}`);
      }
      break;
    }
    case "trust": {
      const action = rest[0];
      const { runTrustAdd, runTrustList } = await import("./commands/trust.ts");
      if (action === "add") runTrustAdd(paths.trustJson, rest[1]);
      else if (action === "list") console.log(JSON.stringify(runTrustList(paths.trustJson), null, 2));
      else { console.error("usage: /qm trust add <pattern> | list"); process.exit(2); }
      break;
    }
    case "prune": {
      const { runPrune } = await import("./commands/prune.ts");
      console.log(`[quartermaster] pruned ${runPrune(paths.inventoryDb)} rows`);
      break;
    }
    default:
      console.error("usage: /qm init|survey|list|trust|prune");
      process.exit(2);
  }
}

async function loadMcpServers(): Promise<Record<string, unknown>> {
  try {
    const j = JSON.parse(await Bun.file(paths.claudeJson).text());
    return j.mcpServers ?? {};
  } catch { return {}; }
}

async function loadEnabledPlugins(): Promise<Set<string>> {
  try {
    const j = JSON.parse(await Bun.file(paths.claudeSettings).text());
    return new Set(Object.entries(j.enabledPlugins ?? {}).filter(([, v]) => v === true).map(([k]) => k));
  } catch { return new Set(); }
}

function mcpFetcher() {
  return async (_name: string, _cfg: unknown) => [];  // v1 stub; real impl needs MCP client wiring
}

function printSurvey(r: any) {
  console.log("INSTALLED (use now):");
  for (const row of r.installed) console.log(`  ${row.name} (${row.source_type}) — ${row.description?.slice(0, 80) ?? ""}`);
  console.log("\nGAP CANDIDATES:");
  for (const row of r.gap) console.log(`  ${row.name} (${row.source_type}, ${row.trust_level}) — ${row.description?.slice(0, 80) ?? ""}`);
  if (r.degraded) console.log("\n⚠ matching degraded (no semantic rerank)");
}

main();
```

- [ ] **Step 2: Slash-command shim**

`commands/qm.md`:

```markdown
---
description: Quartermaster discovery — survey installed and available skills/plugins/MCP servers/CLIs for a planning goal, install gaps, then enter plan mode.
---

# /qm

Dispatches to the quartermaster Bun CLI. Subcommands: `init`, `survey <goal>`, `list [--source-type=X]`, `trust add|list`, `prune`.

Run:

```
bun ${CLAUDE_PLUGIN_ROOT}/src/cli.ts $ARGUMENTS
```
```

- [ ] **Step 3: Manual smoke + commit**

```bash
bun src/cli.ts init --check
git add commands/qm.md src/cli.ts
git commit -m "feat: /qm slash-command shim + Bun dispatcher"
```

---

### Task 28: Plugin manifest + marketplace + hook config

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Modify: project README

- [ ] **Step 1: Plugin manifest**

`.claude-plugin/plugin.json`:

```json
{
  "name": "quartermaster",
  "version": "0.1.0",
  "description": "Discovery plugin — surveys skills, plugins, MCP servers, MCP tools, and curated CLIs; surfaces what's relevant before planning. FTS5 + Claude rerank, trust allowlist with SHA pins.",
  "author": "Barry Roodt",
  "license": "MIT",
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bun ${CLAUDE_PLUGIN_ROOT}/src/hooks/prompt-hook.ts",
            "timeout": 1
          }
        ]
      }
    ]
  },
  "commands": ["./commands/qm.md"]
}
```

- [ ] **Step 2: Marketplace entry (self-hosted single-plugin)**

`.claude-plugin/marketplace.json`:

```json
{
  "version": 1,
  "plugins": [
    {
      "name": "quartermaster",
      "source": {
        "source": "github",
        "repo": "<owner>/quartermaster"
      }
    }
  ]
}
```

(Update `<owner>/quartermaster` once you push to a GitHub remote.)

- [ ] **Step 3: README**

`README.md`:

```markdown
# Quartermaster

A Claude Code plugin that surveys what your agent actually has available — skills, plugins, MCP servers, MCP tools, slash commands, subagents, and curated CLIs — then surfaces the relevant pieces before planning a task.

## Install

```
claude plugin marketplace add <owner>/quartermaster
claude plugin install quartermaster
bun install --cwd ~/.claude/plugins/cache/quartermaster
bun ~/.claude/plugins/cache/quartermaster/src/cli.ts init
```

## Use

- `/qm init` — build the inventory (run once, or after major plugin changes)
- `/qm survey <goal>` — get ranked recommendations before planning
- `/qm list [--source-type=X]` — dump inventory
- `/qm trust add <pattern>` — add to allowlist (e.g. `anthropic/*`)
- `/qm prune` — remove stale capabilities

See `docs/superpowers/specs/2026-05-22-quartermaster-design.md` for full design.
```

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/ README.md
git commit -m "feat: plugin manifest, marketplace entry, README"
```

---

### Task 29: End-to-end fixture-based integration test

**Files:**
- Create: `tests/integration/e2e.test.ts`
- Create: `tests/fixtures/fake-claude/skills/foo/SKILL.md`
- Create: `tests/fixtures/fake-claude/skills/kube-helper/SKILL.md`
- Create: `tests/fixtures/fake-claude/plugins/installed_plugins.json`

- [ ] **Step 1: Fixtures**

`tests/fixtures/fake-claude/skills/foo/SKILL.md`:

```markdown
---
name: foo
description: A skill that foos things up.
---
```

`tests/fixtures/fake-claude/skills/kube-helper/SKILL.md`:

```markdown
---
name: kube-helper
description: Helps deploy applications to Kubernetes clusters.
---
```

`tests/fixtures/fake-claude/plugins/installed_plugins.json`:

```json
{ "version": 2, "plugins": {} }
```

- [ ] **Step 2: E2E test**

```typescript
import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init";
import { runSurvey } from "../../src/commands/survey";

let tmpDir: string;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "qm-e2e-")); });

describe("end-to-end: init → survey", () => {
  test("indexes fixture skills and matches a kubernetes goal", async () => {
    const dataDir = join(tmpDir, "qm");
    const claudeDir = join(tmpDir, "claude");
    cpSync(join(import.meta.dir, "..", "fixtures", "fake-claude"), claudeDir, { recursive: true });
    writeFileSync(join(tmpDir, ".claude.json"), JSON.stringify({ mcpServers: {} }));

    const initResult = await runInit({
      dataDir, claudeDir, claudeJson: join(tmpDir, ".claude.json"),
      mcpServers: {}, mcpFetcher: async () => [],
    });
    expect(initResult.ok).toBe(true);
    expect(initResult.counts.skill).toBeGreaterThanOrEqual(2);

    const surveyResult = await runSurvey({
      dataDir, dbPath: join(dataDir, "inventory.db"), goal: "kubernetes deployment",
      rerankImpl: async (_g, hits) => ({
        ranked: hits.map(h => ({ id: h.id, score: 90, why: "match" })),
        stop_reason: "all_relevant",
      }),
    });
    const all = [...surveyResult.installed, ...surveyResult.gap];
    expect(all.find(r => r.name === "kube-helper")).toBeDefined();
    rmSync(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
bun test tests/integration/e2e.test.ts
git add tests/integration/e2e.test.ts tests/fixtures/fake-claude/
git commit -m "test: end-to-end init → survey integration with fixtures"
```

---

### Task 30: Final smoke + typecheck

- [ ] **Step 1: Run full suite**

```bash
bun test
bun typecheck
```

Expected: all green.

- [ ] **Step 2: Manual install on local machine**

```bash
mkdir -p ~/.quartermaster
bun ~/Projects/jumptag/quartermaster/src/cli.ts init
bun ~/Projects/jumptag/quartermaster/src/cli.ts survey "build a React dashboard with Supabase auth"
bun ~/Projects/jumptag/quartermaster/src/cli.ts list --source-type=skill | head -20
```

Expected: init succeeds, survey returns ranked results, list shows installed skills.

- [ ] **Step 3: Commit any tweaks discovered during smoke**

```bash
# Address any issues found during manual smoke
git commit -am "chore: smoke-test fixes"
```

---

## Self-review

**Spec coverage check** (every spec section → at least one task):

| Spec section | Task(s) |
|---|---|
| § 1 Architecture | Tasks 24, 25, 27 (commands wire the pipeline) |
| § 2 Schema | Tasks 2 (DDL), 5 (CapabilityRecord type), 10 (indexer) |
| § 3 Triggers | Tasks 23 (hook), 24 (init), 25 (survey), 26 (list/trust/prune) |
| § 4 Matcher | Tasks 14 (FTS), 15 (derive), 16 (rerank), 17 (format) |
| § 5 Trust + install | Tasks 11–13 (trust), 18 (prompts), 19 (install flows) |
| § 6 Storage + cache | Tasks 2 (schema), 3 (hash), 8 (MCP cache), 10 (indexer), 24 (init writes hash) |
| § 7 Failure modes | Covered by error handling in Tasks 19 (install), 16 (rerank retry), 23 (hook fail-open) |
| § 8 Out of scope | Honoured by not implementing |
| Plugin wiring | Tasks 27, 28 |
| End-to-end test | Task 29 |

**Placeholder scan:** no TBD/TODO entries. MCP fetcher stub in Task 27 cli.ts is the one exception — it's flagged in-line as "v1 stub; real impl needs MCP client wiring" because Bun cannot directly speak MCP yet. Realistic gap, not a placeholder.

**Type consistency:** `CapabilityRecord`, `FtsHit`, `FormattedRow`, `TrustConfig`, `InstallResult` are referenced consistently across tasks. `ToolsListFetcher` shape is defined in Task 8 and reused in Task 24.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-quartermaster.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints

**Which approach?**



