import { statSync } from "node:fs";
import { createHash } from "node:crypto";
import { paths as appPaths } from "../paths.ts";

export function contentHash(description: string | null, keywords: string | null): string {
  return createHash("sha1").update(`${description ?? ""}\n${keywords ?? ""}`).digest("hex").slice(0, 12);
}

export function signatureHash(paths: string[]): string {
  const parts: string[] = [];
  for (const p of paths) {
    try {
      const s = statSync(p);
      parts.push(`${p}:${s.mtimeMs}`);
    } catch {
      parts.push(`${p}:`);
    }
  }
  return createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 12);
}

export function defaultSignatureInputs(): string[] {
  return [
    appPaths.claudePluginsManifest,
    appPaths.claudeSettings,
    appPaths.claudeJson,
    appPaths.claudeSkills,
    appPaths.claudeCommands,
    appPaths.claudeAgents,
    appPaths.cliExtras,
  ];
}
