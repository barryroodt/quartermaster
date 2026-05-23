import { $ } from "bun";

export interface RegistryHit {
  name: string;
  canonical: string;
  installs?: number;
  url: string;
  registry: "skills.sh" | "brew" | "npm" | "cargo" | "claude-marketplace";
}

export type Runner = (query: string) => Promise<string>;

const defaultSkillsRunner: Runner = async (q) => (await $`npx -y skills find ${q}`.quiet().nothrow()).stdout.toString();

export async function searchSkillsSh(query: string, runner: Runner = defaultSkillsRunner): Promise<RegistryHit[]> {
  const out = await runner(query);
  const lines = out.split("\n");
  const hits: RegistryHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([^\s]+\/[^\s]+@[^\s]+)\s+(\d+)\s+installs?/);
    if (m && i + 1 < lines.length) {
      const urlMatch = lines[i + 1].match(/https:\/\/\S+/);
      hits.push({
        name: m[1].split("@")[1],
        canonical: m[1],
        installs: parseInt(m[2], 10),
        url: urlMatch?.[0] ?? "",
        registry: "skills.sh",
      });
    }
  }
  return hits;
}

const defaultBrewRunner: Runner = async (q) => (await $`brew search ${q}`.quiet().nothrow()).stdout.toString();

export async function searchBrew(query: string, runner: Runner = defaultBrewRunner): Promise<RegistryHit[]> {
  const out = await runner(query);
  return out.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 10).map(name => ({
    name, canonical: name, url: `https://formulae.brew.sh/formula/${name}`, registry: "brew" as const,
  }));
}
