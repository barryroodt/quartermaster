import { existsSync, statSync } from "node:fs";

// Surface-level file check: every path exists and is non-empty. Does NOT
// validate content shape (e.g. SKILL.md YAML frontmatter) — that's the
// installer's job at install time (cf. skill-raw.ts using parseFrontmatter).
export function verifyFilesPresent(files: string[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const f of files) {
    if (!existsSync(f)) { problems.push(`missing: ${f}`); continue; }
    const s = statSync(f);
    if (s.size === 0) problems.push(`empty: ${f}`);
  }
  return { ok: problems.length === 0, problems };
}
