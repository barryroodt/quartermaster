import { existsSync, writeFileSync, readFileSync } from "node:fs";
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
  const storedHash = existsSync(hashPath) ? readFileSync(hashPath, "utf8").trim() : "";
  const stale = currentHash !== storedHash;

  const techList = cls.techKeywords.slice(0, 5).join(", ");
  let out = `[quartermaster] planning intent detected with tech keywords: [${techList}].\n`;
  out += `Consider /qm survey "<prompt summary>" before deep planning.\n`;
  if (stale) out += `⚠ Inventory stale. Run /qm init to refresh.\n`;
  return { output: out };
}

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
