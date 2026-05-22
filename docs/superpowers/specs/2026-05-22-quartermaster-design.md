---
title: Quartermaster — Discovery Plugin Design
date: 2026-05-22
status: draft (awaiting user review)
author: Barry Roodt (with Claude)
slug: quartermaster
---

# Quartermaster — Discovery Plugin Design

A Claude Code plugin that surveys what the agent actually has available — skills, plugins, MCP servers, MCP tools, slash commands, subagents, and curated CLIs on PATH — and surfaces the relevant pieces before planning a task.

---

## Problem

When Claude Code begins planning a task, the agent's awareness of available tooling is uneven:

- Built-in tools are always known.
- Skills are listed in the session prompt but easy to ignore in deep planning.
- Plugins ship their own slash commands, subagents, and MCP servers, but the agent often defaults to base knowledge instead of pulling the right plugin-provided capability.
- MCP servers expose tools that are deferred and only surfaced via `ToolSearch`.
- CLIs on PATH (`gh`, `kubectl`, `terraform`, etc.) are invisible unless the agent thinks to try them.

The result: the agent re-derives behaviour from scratch when a domain-specific capability already exists. Discovery is whatever the model happens to remember, not a deliberate pass.

## Prior art

The closest existing tool is **skillless** ([github.com/0oooooooo0/skillless](https://github.com/0oooooooo0/skillless)) — a pure-markdown Claude Code plugin (~378 lines across 5 files) that runs a `/plans <goal>` command, parses the goal for tech keywords, globs project manifests, diffs detected tech against installed skills, searches gaps via `npx skills find` + GitHub web search, installs accepted recommendations, then calls `EnterPlanMode`.

**What skillless does well (kept):**

- The install-before-planning handoff is the right shape. Tools landed mid-planning are useful immediately.
- Source-prioritised fallback chain (local glob → registry CLI → GitHub web search), gated by result-count thresholds.
- Distinct install flows per source type with conflict detection and post-install verification.

**Where skillless falls short (addressed below):**

| Limitation | Quartermaster's answer |
|---|---|
| Only discovers skills | Unified discovery across skills, plugins, commands, agents, MCP servers, MCP tools, and curated CLIs |
| Shallow matching (literal grep on SKILL.md body) | FTS5 over frontmatter `description` field, then Claude rerank for semantic relevance |
| Manual `/command` only | Passive `SessionStart` baseline + `UserPromptSubmit` planning-intent nudge + explicit `/qm survey` |
| No trust / verification layer | Allowlist of trusted sources + SHA-pin manifest with drift detection |
| Locale-specific UX baked into prompts | Plain English; locale handled by the user's shell |

## Design goals

1. **Discovery is one pass across all source types.** Skills, plugins, commands, agents, MCP servers, MCP tools, CLIs all land in one normalised inventory.
2. **Cheap when idle, deep when asked.** Hooks have sub-200ms budgets and never call LLMs or perform network I/O. Real work runs only from explicit commands.
3. **Matching is semantic, not lexical.** FTS5 narrows the field; one Claude call ranks the candidates.
4. **Trust is explicit and incremental.** Allowlist auto-installs from known sources; everything else is a confirm prompt that can promote-to-trusted in one keystroke.
5. **Every layer fails closed and degrades gracefully.** No silent fallback to less-safe behaviour; related layers keep working when one fails.
6. **YAGNI ruthlessly.** No embeddings, no vector DB, no daemon, no telemetry in v1.

---

## Section 1 — Architecture

**Components:**

```
┌──────────────────────────────────────────────────────────────┐
│  EVENTS                                                       │
│  ├─ SessionStart hook ──────► baseline inventory injection    │
│  ├─ UserPromptSubmit hook ──► intent classifier → deep pass   │
│  └─ /qm <subcommand> ──────► explicit survey / install / list │
└──────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────┐
│  INDEXER (one-shot, hash-gated)                              │
│  Inputs: installed_plugins.json mtime, `claude mcp list`     │
│          hash, ~/.claude/skills mtime, PATH binary list,     │
│          curated CLI manifest + user extras                  │
│  Output: normalised capability records → SQLite              │
└──────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────┐
│  STORE (~/.quartermaster/)                                    │
│  ├─ inventory.db   (SQLite + FTS5 over name/description)     │
│  ├─ trust.json     (allowlist + installed-SHA pins)          │
│  └─ inventory.hash (cache-invalidation key)                  │
└──────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────┐
│  MATCHER (on demand)                                          │
│  goal-text → FTS5 narrow (top 20) → Claude rerank → top 5    │
│  Surfaces installed-but-relevant + gap candidates             │
└──────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────┐
│  INSTALLER (gated)                                            │
│  Trusted source → auto + SHA pin                              │
│  Untrusted → confirm prompt → offer promote-to-trusted        │
│  Source-typed flows: claude plugin / npx skills / curl SKILL  │
└──────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────┐
│  HANDOFF                                                      │
│  EnterPlanMode with goal + ranked capability summary          │
└──────────────────────────────────────────────────────────────┘
```

**Data flow by event:**

| Event | Indexer | Matcher | Installer | Handoff |
|---|---|---|---|---|
| `/qm init` (+ variants) | always | NO | NO | NO |
| SessionStart hook | NO — checks hash and emits ⚠ stale warning only; never re-indexes from a hook | NO — just injects names | NO | NO |
| UserPromptSubmit hook | NO (read cache) | NO (regex classifier only) | NO | NO (nudge text only) |
| `/qm survey <goal>` | refresh if stale | YES | YES (with confirms) | `EnterPlanMode(<goal>)` |

**Contracts:**

- Indexer is the only writer to `inventory.db`. Hooks and matcher only read.
- Indexer is idempotent and hash-gated. Skipping costs one `stat`. Running costs <500ms for typical inventories (hundreds of records).
- All install actions are explicit. Trust gate determines *prompt vs auto-confirm*, never *install vs skip*.

**Runtime:** Bun. Sub-100ms cold start, SQLite built-in, single binary deploy via plugin install. Matches claude-mem's precedent.

---

## Section 2 — Capability record schema

Hybrid model: one row per addressable capability (skill, plugin, command, agent, MCP server, MCP tool, CLI), with bundle metadata when applicable.

**Source types (`source_type`):**

- `skill` — SKILL.md (standalone or inside plugin)
- `plugin` — whole plugin (bundle-level record)
- `command` — slash command (from plugin or `~/.claude/commands/`)
- `agent` — subagent definition
- `mcp_server` — registered MCP server
- `mcp_tool` — individual tool exposed by an MCP server
- `cli` — executable on PATH (curated or user-added)

**SQLite DDL:**

```sql
CREATE TABLE capabilities (
  id              TEXT PRIMARY KEY,           -- stable: <source_type>:<canonical_name>
  source_type     TEXT NOT NULL,
  name            TEXT NOT NULL,              -- short name (display)
  canonical_name  TEXT NOT NULL,              -- match key
  description     TEXT,
  keywords        TEXT,                       -- JSON array, optional
  installed       INTEGER NOT NULL,           -- 0/1
  enabled         INTEGER,                    -- 0/1/NULL (meaningful only for plugin)

  -- bundle metadata (nullable when leaf is standalone)
  bundle_kind     TEXT,                       -- 'plugin' | 'marketplace' | NULL
  bundle_id       TEXT,                       -- e.g. "claude-mem@thedotmack"
  bundle_version  TEXT,
  bundle_path     TEXT,

  -- provenance
  source_url      TEXT,
  source_sha      TEXT,
  trust_level     TEXT NOT NULL,              -- 'trusted' | 'unknown' | 'untrusted'

  -- invocation hint
  invocation      TEXT,                       -- JSON: {style, example}

  -- index hygiene
  last_seen_epoch INTEGER NOT NULL,
  content_hash    TEXT NOT NULL               -- hash(description+keywords)
);

CREATE VIRTUAL TABLE capabilities_fts USING fts5(
  name, canonical_name, description, keywords,
  content='capabilities', content_rowid='rowid'
);

CREATE TABLE install_history (
  capability_id   TEXT NOT NULL,
  source_sha      TEXT NOT NULL,
  installed_at    INTEGER NOT NULL,
  installed_by    TEXT,                       -- 'auto-trusted' | 'user-confirm' | 'manual' | 'pre-existing'
  PRIMARY KEY (capability_id, installed_at)
);

CREATE TABLE mcp_tool_cache (
  server_name        TEXT PRIMARY KEY,
  server_config_hash TEXT NOT NULL,
  tools_json         TEXT NOT NULL,
  fetched_at         INTEGER NOT NULL,
  ttl_epoch          INTEGER NOT NULL
);
```

**`invocation` JSON per source_type:**

| source_type | Example |
|---|---|
| `skill` | `{"style": "skill", "name": "superpowers:brainstorming"}` |
| `command` | `{"style": "slash", "name": "/qm survey"}` |
| `mcp_tool` | `{"style": "tool", "name": "mcp__context7__query-docs"}` |
| `mcp_server` | `{"style": "server", "name": "context7", "load_tools_via": "ToolSearch"}` |
| `agent` | `{"style": "agent", "subagent_type": "Explore"}` |
| `cli` | `{"style": "bash", "example": "gh pr list --state open"}` |
| `plugin` | `{"style": "install", "cmd": "claude plugin install <id>"}` |

**ID conventions (`canonical_name`):**

| source_type | Pattern | Example |
|---|---|---|
| skill | `<plugin-slug?>:<skill-slug>` | `superpowers:brainstorming` |
| plugin | `<name>@<marketplace>` | `claude-mem@thedotmack` |
| command | `<plugin?>/<command>` | `caveman/caveman-help` |
| agent | `<plugin?>:<agent-name>` | `understand-anything:domain-analyzer` |
| mcp_server | `<server-name>` | `context7` |
| mcp_tool | `mcp__<server>__<tool>` | `mcp__context7__query-docs` |
| cli | `bin:<basename>` | `bin:gh` |

**Description sourcing matrix:**

| source_type | Primary | Fallback |
|---|---|---|
| skill | SKILL.md frontmatter `description:` | first H1 line |
| plugin | `.claude-plugin/plugin.json` `description` | marketplace.json entry |
| command | command-file frontmatter `description:` | first non-frontmatter line |
| agent | agent frontmatter `description:` | none — record-but-flag |
| mcp_server | curated map (context7 → "library docs") + `mcp/<server>/server.json` if present | server name only |
| mcp_tool | tool schema `description` (from `tools/list` MCP call) | parent server desc + tool name |
| cli | curated manifest | `man <bin>` whatis line; never `--help` (hang risk) |

---

## Section 3 — Discovery triggers

### Subcommand surface

| Command | Behaviour | When to use |
|---|---|---|
| `/qm init` | Build inventory from empty; create `~/.quartermaster/` tree; seed trust.json with sensible defaults | First run after plugin install |
| `/qm init --force` | Drop existing DB, full rebuild | Schema migration, corruption recovery |
| `/qm init --refresh-cli` | Re-seed CLI manifest only | After plugin update |
| `/qm init --refresh-mcp` | Refresh MCP `tools/list` cache | After MCP server changes |
| `/qm init --check` | Dry-run, write nothing, report what would index | Debugging "why isn't X found" |
| `/qm survey <goal>` | Match + recommend + install + EnterPlanMode | Planning a feature |
| `/qm list [--source-type X]` | Dump inventory rows | Manual inspection |
| `/qm trust add <pattern>` | Add to allowlist (e.g. `anthropic/*`) | Mid-session trust grants |
| `/qm trust list` | Show current allowlist + pin count | Audit |
| `/qm prune` | Remove records marked `installed: 0` from prior versions | Cleanup after uninstalls |

### Triggers

| Trigger | Phase | Blocking budget | Reads | Writes |
|---|---|---|---|---|
| `/qm init` (+ variants) | user-explicit | unbounded (foreground) | filesystem, `claude mcp list`, PATH | `inventory.db`, `trust.json` |
| SessionStart hook | passive | 200ms hard cap | `inventory.db`, `inventory.hash` | NONE |
| UserPromptSubmit hook | conditional | 50ms hard cap | `inventory.hash` for staleness flag | NONE |
| `/qm survey <goal>` | user-explicit | unbounded | inventory.db; may call Claude rerank + WebSearch | `install_history` if install consented |

### SessionStart hook (bash, `~/.quartermaster/hooks/session-start.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail
DB="$HOME/.quartermaster/inventory.db"
HASH_FILE="$HOME/.quartermaster/inventory.hash"

# Cold install — nudge once, exit
if [[ ! -f "$DB" ]]; then
  echo "[quartermaster] index not built. Run /qm init to enable discovery."
  exit 0
fi

# Stale-check via mtime sum (cheap)
CUR_HASH=$(stat -f%m \
  "$HOME/.claude/plugins/installed_plugins.json" \
  "$HOME/.claude/skills" \
  "$HOME/.claude.json" 2>/dev/null | sha1sum | cut -c1-12)
STORED_HASH=$(cat "$HASH_FILE" 2>/dev/null || echo "")

bun "$HOME/.quartermaster/scripts/baseline-context.js" \
  --max-items 25 \
  --stale=$([[ "$CUR_HASH" != "$STORED_HASH" ]] && echo true || echo false)
```

### Baseline context (injected at SessionStart, <600 tokens)

```
[quartermaster] discovery index loaded. 142 capabilities indexed
(87 skills, 21 plugins, 12 commands, 7 MCP servers, 15 CLIs).
3 plugins disabled.

Use /qm survey <goal> for ranked recommendations before planning.
Use /qm list --source-type mcp_tool to dump a category.

⚠ Inventory is stale (last built 2026-05-19, plugin manifest changed since).
  Run /qm init to refresh.    [only shown when stale]
```

### UserPromptSubmit intent classifier

Hard-coded regex + keyword match. No LLM call (50ms budget). Fires only when **both** a planning-shape AND a tech-keyword are present, to keep the false-positive rate low.

```js
const PLANNING_TRIGGERS = [
  /^(plan|design|brainstorm|build|implement|create|set up)\b/i,
  /\bhow (would|should|do) (i|we|you)\b/i,
  /\bwhat['']?s? the best way to\b/i,
  /\b(approach|strategy|architecture) for\b/i,
];
const TECH_PATTERN = /\b(react|vue|nextjs|django|fastapi|kubernetes|docker|...)\b/i;
```

On match, emit a short prompt-context block:

```
[quartermaster] planning intent detected with tech keywords: [react, supabase].
Consider /qm survey "<prompt summary>" before deep planning.
3 installed capabilities likely relevant: superpowers:brainstorming, react-patterns, supabase-mcp.
2 gap candidates available: vite-optimization (skills.sh, trusted), shadcn-ui (github, unknown).
```

**Hook suggests; it does not run survey.** Auto-execution from a hook is too magical and burns tokens on false positives. The agent decides whether to invoke `/qm survey` based on the nudge.

### `/qm survey <goal>` pipeline

1. Refresh inventory if hash stale (skip otherwise).
2. FTS5 query → top 20 candidates across all source_types.
3. Single Claude call: rerank top 20, return top 5 with one-line justifications. (~1.5K tokens; see Section 4.)
4. Bucket top 5 into `installed` vs `gap`.
5. For each gap candidate, source the install:
   - **Tier 1** — curated registries (skills.sh, claude marketplace catalog, brew, npm, cargo).
   - **Tier 2** — if tier 1 returns <2 results, prompt user: *"No strong matches in known registries. Search the web for relevant tools matching '<goal facet>'? (y/n)"*
   - **Tier 3** — on approval, `WebSearch` with templated query per source_type:
     - `skill`: `site:github.com "SKILL.md" claude <terms>`
     - `mcp_server`: `"mcp server" <terms> site:github.com`
     - `cli`: `<terms> CLI tool site:github.com OR site:crates.io`
   - Dedupe against existing inventory; present results with provenance.
6. Present consolidated recommendation table.
7. For each selected, run installer flow (Section 5).
8. After install completes, `EnterPlanMode(<goal>)`.

---

## Section 4 — Matching pipeline

### Stage 1 — FTS5 narrow (deterministic, <50ms)

Goal text → tokenize → expand with light synonym map (~30 entries: `k8s→kubernetes`, `pg→postgres`, etc.) → FTS5 MATCH.

```sql
SELECT c.id, c.source_type, c.name, c.description, c.installed,
       c.bundle_id, c.trust_level,
       bm25(capabilities_fts, 4.0, 3.0, 1.0, 1.5) AS rank
FROM capabilities_fts
JOIN capabilities c ON c.rowid = capabilities_fts.rowid
WHERE capabilities_fts MATCH :query
ORDER BY rank
LIMIT 20;
```

Column weights: name 4.0, canonical_name 3.0, description 1.0, keywords 1.5.

### Stage 2 — Claude rerank (semantic, ~1.5K tokens)

Single API call. Structured input, structured output.

```
SYSTEM: You rank capabilities by relevance to a user's coding goal. Output
        strict JSON only.

USER:
Goal: <goal text>

Candidates:
[1] superpowers:brainstorming (skill, installed)
    Use before any creative work — creating features, building components, ...
[2] mcp__context7__query-docs (mcp_tool, installed)
    Fetch current documentation for libraries, frameworks, SDKs, APIs.
...
[20] vite-optimization (skill, gap — skills.sh)
    Vite build optimization patterns.

Return JSON:
{
  "ranked": [
    {"id": "<id>", "score": 0-100, "why": "<one sentence>"},
    ... top 5 only
  ],
  "stop_reason": "all_relevant" | "low_confidence" | "exhausted"
}
```

**Why one call, not per-candidate:** flat cost regardless of candidate count up to 20; LLM sees the full set so ranking is comparative; `stop_reason` lets matcher detect "FTS narrowed wrong; widen the net" cases.

### Stage 3 — split + present

Ranked top 5 bucketed by `installed`:

| Use now (installed) | Install candidates (gap) |
|---|---|
| ① superpowers:brainstorming | ④ vite-optimization (skills.sh, trusted) |
| ② mcp__context7__query-docs | ⑤ supabase-mcp (github, unknown) |
| ③ rtk-routing | |

User picks install candidates by number. Use-now items are surfaced but not actioned (the agent uses them during plan mode).

### Edge cases

| Case | Behaviour |
|---|---|
| FTS5 returns 0 rows | Skip rerank; jump straight to gap-tier-1 |
| Rerank `stop_reason: low_confidence` | Surface candidates with warning; suggest goal refinement |
| Rerank `stop_reason: exhausted` | Trigger gap-tier-1 even though FTS had hits |
| Goal text < 4 words | Skip rerank — too little signal; return FTS top 10 by bm25 |
| Claude API unreachable | Fall back to FTS-only ranking; flag degraded mode in output |
| Special chars in goal (`/`, `:`, `@`) | Pre-sanitise: strip non-alphanumeric (except space/hyphen) before MATCH |
| Non-English goal | unicode61 tokenizer (FTS5 default); rerank compensates for lower precision |

### Token budget

| Component | Tokens |
|---|---|
| System prompt | ~150 |
| 20-candidate list (avg 30 each) | ~600 |
| Goal + instructions | ~100 |
| JSON output (top 5 + reasoning) | ~400 |
| **Total** | **~1.25K input, ~400 output** |

Cheap enough to run every `/qm survey` without budgeting.

**No embeddings, no Chroma, no local model.** Deferred to v2 if inventory grows past ~500 records. Schema's `content_hash` is forward-compatible.

---

## Section 5 — Trust + install layer

### `~/.quartermaster/trust.json`

```json
{
  "version": 1,
  "trusted_patterns": [
    "anthropic/*",
    "anthropics/*",
    "superpowers-marketplace",
    "claude-plugins-official",
    "thedotmack/claude-mem"
  ],
  "blocked_patterns": [],
  "pins": {
    "skill:superpowers:brainstorming": {
      "source_sha": "5faddc4087553bdc3c7ee98a83300e844295207e",
      "installed_at": 1716379200,
      "installed_by": "auto-trusted",
      "source_url": "https://github.com/superpowers-marketplace/superpowers"
    }
  }
}
```

**Pattern matching:** glob-style on `<owner>/<repo>` or marketplace name. Wildcards only at trailing position (`anthropic/*` ok; `*/foo` not). Case-insensitive. Exact match wins over wildcard.

**Validation on write:** reject `*/*` and bare `*`; require at least one literal character.

### Trust decision flow per install

```
identify(candidate) → {source_url, source_sha, canonical_name}
                      │
                      ▼
         ┌─ trust_lookup(source_url) ─┐
         │                            │
       blocked              trusted             unknown
         │                    │                    │
       refuse           pin_check                prompt_user
         │                    │                    │
                       ┌──┴──┐              ┌─────┴─────┐
                    no pin  pin            confirm    skip
                       │     │                │         │
                    install  sha_match?     install   abort
                            │       │         │
                          same    drift      │
                            │       │        │
                         install confirm  prompt_promote
                                  user      ("add <owner>
                                  │          to trusted?")
                                  │              │
                              install ──────  yes / no
                                                  │
                                              update
                                              trust.json
```

### SHA drift handling

When re-installing a pinned capability:

- `source_sha == pin.source_sha` → silent (already at pinned version).
- `source_sha != pin.source_sha` → block with diff and prompt:

  ```
  ⚠ Pin drift detected for skill:foo/bar
    Pinned:  4d91053  (2026-02-06)
    Latest:  a3f0b22  (2026-05-20, +3 months)

  Updating could introduce malicious changes or breakage.
  View diff at https://github.com/foo/bar/compare/4d91053...a3f0b22

  Update pin to latest? [y/N]
  ```

`--yes` flag never bypasses drift prompts; only bypasses pristine-new installs.

### Source-typed install flows

| source_type | Mechanism | SHA capture |
|---|---|---|
| `plugin` | `claude plugin install <id>` | parse `installed_plugins.json` after install |
| `skill` (skills.sh) | `npx skills add -y -g <owner/repo>` | `git -C ~/.claude/skills/<name> rev-parse HEAD` |
| `skill` (raw SKILL.md) | WebFetch → write to `~/.claude/skills/<name>/SKILL.md` | hash file content (no git SHA available) |
| `mcp_server` | `claude mcp add <name> <transport-args>` | hash server config block in `~/.claude.json` |
| `cli` (brew) | print suggested `brew install <pkg>` — never run silently | post-confirm capture `brew list --versions <pkg>` |
| `cli` (npm) | print `npm i -g <pkg>` — same | post-confirm capture from `npm ls -g --json` |

**Key boundary:** the plugin never installs CLIs directly. It always prints the command and asks the user to run it. Package managers prompt for sudo, run post-install scripts, modify shell rc files — too much surface to automate inside another tool's permission flow.

### Promote-to-trusted prompt

After a user manually approves an untrusted install:

```
Install successful: skill:foo/bar @ a3f0b22

Source github.com/foo is not in your trusted_patterns. Add to allowlist?

  (1) Yes, trust foo/*           (whole org auto-installs in future)
  (2) Yes, trust foo/bar only    (just this repo)
  (3) No, keep prompting          (status quo — confirm every time)

[1/2/3]
```

Default `3` on enter. Choice persists to `trust.json`.

### Installer return contract

```json
{
  "capability_id": "skill:foo/bar",
  "status": "installed" | "skipped" | "blocked" | "failed",
  "source_sha": "a3f0b22...",
  "trust_action": "auto-trusted" | "user-confirm" | "promoted-org" | "promoted-repo",
  "post_install": {
    "verified": true,
    "files": ["~/.claude/skills/foo-bar/SKILL.md"],
    "errors": []
  }
}
```

Survey aggregates these into the final summary table before `EnterPlanMode`.

### What this layer does NOT do (v1)

- No automatic uninstall. Stale capabilities stay indexed (with `installed: 1`) until user runs `/qm prune`.
- No signature verification. SHA pinning is integrity-against-drift, not authenticity. Real signing requires sigstore/cosign infra; out of scope.
- No quarantine sandbox. Install runs in the user's shell with the user's permissions, same as `claude plugin install` already does.

---

## Section 6 — Storage + cache invalidation

### Directory layout (`~/.quartermaster/`)

```
~/.quartermaster/
├── inventory.db              SQLite primary (capabilities + install_history + FTS5)
├── inventory.db-wal          WAL mode for concurrent reads while indexer writes
├── inventory.db-shm
├── inventory.hash            12-char hash of input signature
├── trust.json                allowlist + pins (Section 5)
├── cli-extras.json           user-extended CLI manifest
├── synonyms.json             goal-text expansion map
├── logs/
│   └── quartermaster-YYYY-MM-DD.log
├── scripts/                  bundled bun scripts (symlink to plugin install dir)
│   ├── indexer.js
│   ├── matcher.js
│   ├── installer.js
│   └── baseline-context.js
└── hooks/
    ├── session-start.sh
    └── user-prompt-submit.sh
```

### Input-signature hash (`inventory.hash`)

Stat-based, not content-based. Recomputed on every hook tick.

```bash
sha1sum << EOF | cut -c1-12
$(stat -f%m ~/.claude/plugins/installed_plugins.json 2>/dev/null)
$(stat -f%m ~/.claude/settings.json 2>/dev/null)
$(stat -f%m ~/.claude.json 2>/dev/null)
$(stat -f%m ~/.claude/skills 2>/dev/null)
$(stat -f%m ~/.claude/commands 2>/dev/null)
$(stat -f%m ~/.quartermaster/cli-extras.json 2>/dev/null)
$(echo "$PATH" | tr ':' '\n' | sort -u | xargs -I {} stat -f%m {} 2>/dev/null | sort | sha1sum)
EOF
```

PATH binaries hashed by directory mtime only. Adding a new tool to `/opt/homebrew/bin` bumps that dir's mtime → triggers re-index.

### Re-index decision matrix

| Caller | Hash match? | Action |
|---|---|---|
| SessionStart hook | match | Inject baseline, exit |
| SessionStart hook | mismatch | Inject baseline with ⚠ stale warning, exit (do NOT re-index from hook) |
| UserPromptSubmit hook | any | Never re-indexes |
| `/qm survey` | match | Use cached, skip indexer |
| `/qm survey` | mismatch | Run indexer first, then proceed |
| `/qm init` | any | Always re-index (incremental) |
| `/qm init --force` | any | Drop + rebuild |

### Incremental indexer (default, ~500ms typical)

For each source enumerator:

1. Build current-state set: `{(canonical_name, content_hash)}`.
2. Diff against DB: compute add/update/remove.
3. Apply diff in single transaction.
4. FTS5 rebuilds via triggers (already in DDL).

Per-source enumerators:

| Source | Enumeration |
|---|---|
| Plugins | Walk `installed_plugins.json` → for each entry, read `<installPath>/.claude-plugin/plugin.json` for description + version |
| Skills | Glob `~/.claude/skills/*/SKILL.md` (follow symlinks) + every `<plugin>/skills/*/SKILL.md` — parse frontmatter |
| Commands | Glob `~/.claude/commands/**/*.md` + every `<plugin>/commands/**/*.md` — parse frontmatter |
| Agents | Glob `~/.claude/agents/*.md` + every `<plugin>/agents/*.md` — parse frontmatter |
| MCP servers | Parse `~/.claude.json` `mcpServers` object + every `<plugin>/.mcp.json` |
| MCP tools | For each connected server, call MCP `tools/list`; cache per `server_config_hash`; refresh only on change or TTL expiry |
| CLIs | Walk curated manifest (`cli-known.json` bundled with plugin) + `cli-extras.json` — `which <bin>` for each; skip absent |

### MCP `tools/list` caching

```sql
CREATE TABLE mcp_tool_cache (
  server_name        TEXT PRIMARY KEY,
  server_config_hash TEXT NOT NULL,
  tools_json         TEXT NOT NULL,
  fetched_at         INTEGER NOT NULL,
  ttl_epoch          INTEGER NOT NULL     -- fetched_at + 7 days
);
```

Refresh on: `server_config_hash` mismatch OR `now > ttl_epoch` OR explicit `/qm init --refresh-mcp`. Stale-but-cached is fine; remote MCP tool surfaces rarely change.

### Concurrent access

SQLite WAL mode → multiple readers + single writer. Two simultaneous `/qm init` runs: second blocks on writer lock (acceptable; rare).

### Backup + recovery

- `/qm init --force` re-derives everything from filesystem. No data loss possible — DB is pure cache.
- `trust.json` and `cli-extras.json` are NOT regenerable — they hold user choices. `init` never touches them.
- On `inventory.db` corruption: rename to `.db.broken`, run `init`. Log the event.

### Log discipline

Single rotating logfile per day. Indexer writes start/end timestamps, per-source counts, errors. Hooks write nothing on success (logs only on error). Survey writes goal + ranked output + install decisions. ~50KB/day typical.

---

## Section 7 — Failure modes

Categorised failure inventory with the handling rule for each.

### A. Indexer failures

| Failure | Handling |
|---|---|
| `installed_plugins.json` malformed | Skip plugins source, continue others, log error, surface in next baseline as "⚠ plugin enumeration failed" |
| `claude mcp list` hangs >5s | Kill, fall back to `~/.claude.json` raw parse, omit connection-status fields |
| Plugin install dir missing despite manifest entry | Mark capability `installed: 0`, flag in log; user prompted to run `claude plugin reinstall` |
| Symlink loop in `~/.claude/skills` | Use `find -L -maxdepth 3` with timeout; skip cycles |
| SQLite write fails (disk full, perms) | Transaction rollback (atomic), DB stays at last good state, error surfaces |
| Two enumerator runs race | WAL writer lock; second waits |

### B. Matcher failures

| Failure | Handling |
|---|---|
| Claude API unreachable during rerank | Degrade to FTS-only ranking, flag "matching degraded — no semantic rerank" in output |
| Rerank returns malformed JSON | Retry once with explicit "respond ONLY with JSON" suffix; on second failure, fall back to FTS-only |
| FTS5 query has special chars | Pre-sanitise: strip non-alphanumeric except space/hyphen before MATCH |
| Inventory empty (no `init` run) | FTS5 returns 0; refuse with clear message: "No inventory. Run /qm init first." — do not silently web-search |
| Non-English / mixed-script goal | unicode61 tokenizer; accept lower precision; rerank compensates |

### C. Installer failures

| Failure | Handling |
|---|---|
| `claude plugin install` fails (network, auth) | Mark `failed`, surface stderr verbatim, do not pin |
| `npx skills add` silently no-ops (exit 0 but file absent) | Post-install verify catches; mark `failed` |
| WebFetch returns HTML instead of raw SKILL.md | Reject; surface URL; suggest user check repo path |
| User aborts mid-install (SIGINT) | Subprocess inherits; no pin written; partial files left for user to inspect |
| Pin conflict: two capabilities want same `canonical_name` | Refuse second install; surface both source URLs; ask user to disambiguate |
| Install succeeds but capability not picked up by Claude until restart | Surface "restart Claude to use" note; some sources hot-load, others (plugins, MCP) require restart |

### D. Trust failures

| Failure | Handling |
|---|---|
| `trust.json` corrupt | Refuse all auto-installs; require user to fix or run `/qm trust reset` |
| Trust pattern matches too broadly (e.g. `*/*`) | Validate on write: reject `*/*` and bare `*` |
| User adds `anthropic/*`, then anthropic gets compromised (hypothetical) | Not solvable at this layer; would require external advisory feed (out of scope) |
| SHA-drift prompt skipped via repeated `--yes` | `--yes` never bypasses drift prompts |

### E. Hook failures

| Failure | Handling |
|---|---|
| SessionStart hook >200ms budget | Bun script has internal 150ms watchdog; on timeout, emit minimal "[quartermaster] index ready (slow)" and exit |
| UserPromptSubmit hook errors | Fail-open: any error → emit nothing, return 0, log error. User never sees breakage; classifier nudge just doesn't appear |
| Hook fires before `init` ever ran | Emit one-time nudge "Run /qm init"; suppress for rest of session via `~/.quartermaster/.nudged-this-session` marker |

### F. Trigger logic edge cases

| Case | Handling |
|---|---|
| User in plan mode when `/qm survey` runs | Refuse: "Already in plan mode; exit first or use /qm list" |
| Survey called with empty `<goal>` | Prompt: "What are you building?" |
| Survey called from subagent | Skip plan-mode handoff (subagents shouldn't enter plan mode); return ranked candidates as text only |
| `/qm survey` on goal that classifier rejected | Run anyway — user explicit intent overrides classifier |
| Two `/qm survey` calls in same session | Second uses cached inventory if hash unchanged; rerank always fresh |

### G. Cross-source ambiguity

| Case | Handling |
|---|---|
| Skill and MCP tool with same description | Both surface in rerank; LLM picks based on goal context |
| Plugin disabled but skills inside still indexed | Plugin row `enabled: 0`; skills inherit `enabled: 0`; matcher deprioritises (bm25 unaffected, rerank prompt notes disabled status) |
| Capability installed but `enabled: false` | Matcher surfaces with badge `(disabled)`; recommends enable, not install |

### H. Degradation summary

| Layer offline | What still works |
|---|---|
| Claude API down | FTS-only matching; install flows fine; baseline injection fine |
| SQLite corrupt | Hooks emit "run /qm init"; nothing else works until rebuild |
| Network down | All read paths fine; gap-tier-1 registry lookups + tier-3 web search disabled with clear message |
| `claude` CLI broken | Indexer skips plugin enumeration; everything else works |
| MCP servers all disconnected | Indexer uses cached `mcp_tool_cache`; if cache empty, MCP tools absent from index |

**Principle:** every layer fails closed (no silent fallback to less-safe behaviour) but degrades gracefully (related layers keep working). User always gets a message explaining what's degraded.

---

## Section 8 — Out of scope (v1)

| Deferred | Why out | Trigger to revisit |
|---|---|---|
| Local embedding model (fastembed/ONNX) | FTS5+rerank handles ≤500 records cleanly; zero binary deps | Inventory >500 records OR rerank cost becomes annoying |
| Chroma vector DB | Same as above; schema already has `content_hash` for clean future migration | Same trigger as embeddings |
| Cryptographic signature verification (sigstore/cosign) | No mainstream signing in Claude plugin ecosystem yet | When `claude plugin` itself adopts signing |
| Sandboxed install (containers, ephemeral users) | Same trust boundary as native `claude plugin install` already has | When user reports a malicious-plugin incident |
| Auto-uninstall stale capabilities | Destructive; user's installs are user's choice | Never auto. Only ever `/qm prune` with explicit confirm |
| Auto-disable plugins matcher never recommends | Same | Same |
| Team-shared trust files / shared inventories | Personal tool first; team sync requires sync infra, conflict resolution | When second user asks for it |
| Telemetry on which capabilities get recommended | Privacy cost > insight gain at v1 scale | Opt-in only if added |
| LLM-driven classifier in UserPromptSubmit hook | 50ms budget rules out LLM call; regex+keyword sufficient for nudge | If false-positive rate proves intolerable |
| Auto-survey on every prompt | Magical, burns tokens, hard to undo | Never — hook stays "suggest, don't run" |
| Cross-session learning (which recommendations got accepted) | State management complexity; accept/skip already provides feedback | When pattern of bad recommendations emerges |
| GUI / web dashboard for inventory inspection | `/qm list` covers it | When inventory routinely needs faceted browsing |
| MCP server health monitoring / auto-reconnect | `claude mcp` owns connection lifecycle, not us | Not our layer to own |
| Project-local inventory overrides | Personal-tool scope first | When per-repo capability profiles are requested |
| Localisation (skillless's Korean default) | English only; user's prior art shows it confuses agents | Never — locale is user's CLI/shell concern |
| `/qm watch` daemon | Hash-on-tick is good enough; daemon adds process lifecycle | If hash check becomes hot-path bottleneck |
| Inventory diff between sessions ("what's new since last") | Nice-to-have, not load-bearing | When index changes get frequent |

---

## Glossary

| Term | Meaning |
|---|---|
| Capability | Any addressable unit of agent functionality: skill, plugin, command, agent, MCP server, MCP tool, CLI binary |
| Bundle | Container of capabilities (a plugin bundles skills/commands/MCPs; a marketplace bundles plugins) |
| Pin | Recorded SHA of an installed capability, used to detect drift on re-install |
| Trust pattern | Glob over `<owner>/<repo>` or marketplace name that auto-approves installs |
| Gap candidate | A capability the matcher recommended but is not currently installed |
| Stale (inventory) | Input-signature hash on disk differs from current hash; index may be out of date |
