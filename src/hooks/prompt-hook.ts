import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { signatureHash } from "../inventory/hash.ts";
import { classify } from "../classifier/intent.ts";

export interface HookInput {
  prompt: string;
  dataDir: string;
  /** Absolute paths to files/dirs whose mtime+size feed the inventory signature. */
  hashInputPaths: string[];
}

export interface HookOutput { output: string }

export function runHook(input: HookInput): HookOutput {
  return existsSync(join(input.dataDir, "inventory.db"))
    ? intentNudge(input)
    : coldStateNudge(input);
}

function coldStateNudge(input: HookInput): HookOutput {
  const marker = join(input.dataDir, ".init-nudge-shown");
  if (existsSync(marker)) return { output: "" };
  try {
    writeFileSync(marker, "");
  } catch {
    // swallow write errors — still emit the nudge so the user sees it.
  }
  return { output: "[quartermaster] index not built. Run /qm init to enable discovery.\n" };
}

function intentNudge(input: HookInput): HookOutput {
  const cls = classify(input.prompt);
  if (!cls.fire) return { output: "" };

  const hashPath = join(input.dataDir, "inventory.hash");
  const currentHash = signatureHash(input.hashInputPaths);
  const storedHash = existsSync(hashPath) ? readFileSync(hashPath, "utf8").trim() : "";
  const stale = currentHash !== storedHash;

  const techList = cls.techKeywords.slice(0, 5).join(", ");
  const lines = [
    `[quartermaster] planning intent detected with tech keywords: [${techList}].`,
    `Consider /qm survey "<prompt summary>" before deep planning.`,
    stale ? `⚠ Inventory stale. Run /qm init to refresh.` : null,
  ].filter((l): l is string => l !== null);
  return { output: lines.join("\n") + "\n" };
}
