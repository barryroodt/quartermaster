import triggers from "./triggers.json" with { type: "json" };
import techKeywords from "./tech-keywords.json" with { type: "json" };
import synonyms from "../matcher/synonyms.json" with { type: "json" };

const REGEX_META = /[\\^$*+?.()|[\]{}]/g;
function escapeRegex(s: string): string {
  return s.replace(REGEX_META, "\\$&");
}

const PLANNING_TRIGGERS: RegExp[] = (triggers as string[]).map(src => new RegExp(src, "i"));

const TECH_PATTERNS: { keyword: string; re: RegExp }[] = (techKeywords as string[]).map(t => ({
  keyword: t,
  re: new RegExp(`\\b${escapeRegex(t)}\\b`),
}));

const SYN_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(synonyms as Record<string, string[]>).map(([k, v]) => [k, v[0]!]),
);
function normalize(keyword: string): string {
  return SYN_MAP[keyword] ?? keyword;
}

export interface ClassifyResult { planning: boolean; techKeywords: string[]; fire: boolean }

export function classify(prompt: string): ClassifyResult {
  const planning = PLANNING_TRIGGERS.some(re => re.test(prompt));
  const lower = prompt.toLowerCase();
  const rawHits = TECH_PATTERNS.filter(p => p.re.test(lower)).map(p => p.keyword);
  const normalized = rawHits.map(normalize);
  const techKeywords = Array.from(new Set(normalized));
  return { planning, techKeywords, fire: planning && techKeywords.length > 0 };
}
