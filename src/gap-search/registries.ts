import { $ } from "bun";

export type RegistryHit =
  | { registry: "skills.sh"; name: string; canonical: string; installs: number; url: string }
  | { registry: "brew"; name: string; canonical: string; url: string };

export class RegistrySearchFailed extends Error {
  constructor(
    public readonly registry: "skills.sh" | "brew",
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`${registry} search failed (exit ${exitCode}): ${stderr}`);
    this.name = "RegistrySearchFailed";
  }
}

// brew returns dozens of near-matches; matcher re-ranks top hits only
const MAX_BREW_HITS = 10;

// Format reverse-engineered from skills.sh CLI output; verify against real CLI before shipping.
export function parseSkillsShOutput(raw: string): RegistryHit[] {
  const lines = raw.split("\n");
  const hits: RegistryHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([^\s]+\/[^\s]+@[^\s]+)\s+(\d+)\s+installs?/);
    if (!m) continue;
    // Scan forward up to 3 non-blank lines for an https URL; skip hit if none found.
    let url: string | undefined;
    let scanned = 0;
    for (let j = i + 1; j < lines.length && scanned < 3; j++) {
      const candidate = lines[j].trim();
      if (candidate === "") continue;
      scanned++;
      const urlMatch = candidate.match(/https:\/\/\S+/);
      if (urlMatch) {
        url = urlMatch[0];
        break;
      }
    }
    if (!url) continue;
    hits.push({
      registry: "skills.sh",
      name: m[1].split("@")[1],
      canonical: m[1],
      installs: parseInt(m[2], 10),
      url,
    });
  }
  return hits;
}

export function parseBrewOutput(raw: string): RegistryHit[] {
  return raw
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, MAX_BREW_HITS)
    .map(name => ({
      registry: "brew" as const,
      name,
      canonical: name,
      url: `https://formulae.brew.sh/formula/${name}`,
    }));
}

export async function searchSkillsSh(query: string): Promise<RegistryHit[]> {
  const result = await $`npx -y skills find ${query}`.quiet().nothrow();
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (result.exitCode !== 0 && !(stderr === "" && stdout === "")) {
    throw new RegistrySearchFailed("skills.sh", result.exitCode, stderr);
  }
  return parseSkillsShOutput(stdout);
}

export async function searchBrew(query: string): Promise<RegistryHit[]> {
  const result = await $`brew search ${query}`.quiet().nothrow();
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (result.exitCode !== 0 && !(stderr === "" && stdout === "")) {
    throw new RegistrySearchFailed("brew", result.exitCode, stderr);
  }
  return parseBrewOutput(stdout);
}
