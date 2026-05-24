import { runHook } from "./prompt-hook.ts";

const HOOK_BUDGET_MS = 80; // UserPromptSubmit informal budget; verify against Claude Code docs

const HOME = process.env.HOME ?? "";
const dataDir = `${HOME}/.quartermaster`;
const promptText = await Bun.stdin.text();
const hashInputPaths = [
  `${HOME}/.claude/plugins/installed_plugins.json`,
  `${HOME}/.claude/settings.json`,
  `${HOME}/.claude.json`,
  `${HOME}/.claude/skills`,
];

const t0 = performance.now();
try {
  const r = runHook({ prompt: promptText, dataDir, hashInputPaths });
  const dt = performance.now() - t0;
  if (dt > HOOK_BUDGET_MS) process.stderr.write(`[quartermaster:hook] slow: ${dt.toFixed(0)}ms\n`);
  if (r.output) process.stdout.write(r.output);
} catch (e) {
  // fail-open but leave a trail
  process.stderr.write(`[quartermaster:hook] ${e instanceof Error ? e.message : String(e)}\n`);
}
