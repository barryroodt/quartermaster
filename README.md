# Quartermaster

A Claude Code plugin that surveys what your agent actually has available — skills, plugins, MCP servers, MCP tools, slash commands, subagents, and curated CLIs — then surfaces the relevant pieces before planning a task. It builds a SQLite + FTS5 inventory, narrows by full-text search, reranks with Claude, and gates installs through a trust allowlist with SHA pins.

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
- `/qm install <capability_id> [--yes] [--yes-drift]` — install a capability through the trust gate (e.g. `/qm install skill:skills-sh:foo/bar@my-skill`)
- `/qm list [--source-type=X]` — dump inventory
- `/qm trust add <pattern>` — add to allowlist (e.g. `anthropic/*`)
- `/qm prune` — remove stale capabilities

See `docs/superpowers/specs/2026-05-22-quartermaster-design.md` for full design.
See `docs/v0.2-roadmap.md` for known v0.1 limitations (MCP fetcher stub, deferred install kinds, plan-mode handoff).
