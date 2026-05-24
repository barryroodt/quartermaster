// Trust pattern grammar (enforced by validatePattern + honored by matches):
//   owner/repo   exact owner/repo slug (case-insensitive)
//   owner/*      any repo under owner
// Nothing else. Bare owners, mid-wildcards, leading wildcards, and `*/*` are
// rejected. validator + matcher MUST stay in lockstep — patterns the validator
// accepts but the matcher cannot honor produce dead trust entries.
const PATTERN_RE = /^[a-z0-9._-]+\/([a-z0-9._-]+|\*)$/i;

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
  if (!PATTERN_RE.test(pattern)) throw new Error("pattern must be 'owner/repo' or 'owner/*': " + pattern);
}
