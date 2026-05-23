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
