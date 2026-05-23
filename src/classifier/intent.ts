const PLANNING_TRIGGERS: RegExp[] = [
  /^(plan|design|brainstorm|build|implement|create|set up)\b/i,
  /\b(want to|going to|need to|trying to|let['']?s) (plan|design|brainstorm|build|implement|create|set up)\b/i,
  /\bhow (would|should|do) (i|we|you)\b/i,
  /\bwhat['']?s? the best way to\b/i,
  /\b(approach|strategy|architecture) for\b/i,
];

const TECH_KEYWORDS = [
  "react","vue","svelte","angular","nextjs","next.js","remix","astro",
  "django","fastapi","flask","rails","laravel","spring",
  "kubernetes","k8s","docker","terraform","ansible","helm",
  "aws","gcp","azure","vercel","netlify","cloudflare",
  "postgres","postgresql","mysql","sqlite","redis","kafka","rabbitmq","clickhouse","mongodb",
  "prisma","drizzle","sqlalchemy","typeorm",
  "supabase","firebase","auth0","clerk","stripe",
  "typescript","javascript","python","rust","go","golang","ruby","php","java","kotlin","swift",
  "graphql","grpc","trpc","rest","websocket",
  "bun","node","deno","npm","pnpm","yarn","cargo","pip","poetry",
  "vite","webpack","esbuild","turbopack","rollup","parcel",
  "jest","vitest","pytest","playwright","cypress","mocha",
];

export interface ClassifyResult { planning: boolean; techKeywords: string[]; fire: boolean }

export function classify(prompt: string): ClassifyResult {
  const planning = PLANNING_TRIGGERS.some(re => re.test(prompt));
  const lower = prompt.toLowerCase();
  const techKeywords = TECH_KEYWORDS.filter(t => new RegExp(`\\b${t.replace(".", "\\.")}\\b`).test(lower));
  return { planning, techKeywords, fire: planning && techKeywords.length > 0 };
}
