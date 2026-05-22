import { statSync } from "node:fs";
import { createHash } from "node:crypto";

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
  const HOME = process.env.HOME ?? "";
  return [
    `${HOME}/.claude/plugins/installed_plugins.json`,
    `${HOME}/.claude/settings.json`,
    `${HOME}/.claude.json`,
    `${HOME}/.claude/skills`,
    `${HOME}/.claude/commands`,
    `${HOME}/.claude/agents`,
    `${HOME}/.quartermaster/cli-extras.json`,
  ];
}
