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
