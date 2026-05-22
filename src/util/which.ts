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
