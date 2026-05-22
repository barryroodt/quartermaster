const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parseFrontmatter(md: string): { fm: Record<string, string>; body: string } {
  const m = md.match(FRONTMATTER);
  if (!m) return { fm: {}, body: md };
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { fm, body: m[2] };
}

export function extractFromMarkdown(md: string): string | null {
  const { fm, body } = parseFrontmatter(md);
  if (fm.description) return fm.description;
  const firstLine = body.split("\n").map(l => l.trim()).find(l => l.length > 0);
  return firstLine ?? null;
}

export function extractFromJson(json: string): string | null {
  try {
    const obj = JSON.parse(json);
    return typeof obj.description === "string" ? obj.description : null;
  } catch {
    return null;
  }
}
