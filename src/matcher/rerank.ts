import Anthropic from "@anthropic-ai/sdk";
import type { FtsHit } from "./fts.ts";

type Message = Anthropic.Message;

export interface RankedItem { id: string; score: number; why: string }
export type StopReason = "all_relevant" | "low_confidence" | "exhausted";
export interface RerankResult { ranked: RankedItem[]; stop_reason: StopReason }

const MAX_RANKED = 5;
const MODEL = "claude-haiku-4-5-20251001";
const SYSTEM = "You rank capabilities by relevance to a user's coding goal. Output strict JSON only — no preamble, no markdown.";
const VALID_STOP_REASONS: readonly StopReason[] = ["all_relevant", "low_confidence", "exhausted"];

// Prompt includes the actual id on every line; rerank() asks the model to echo
// that same id back. No index→id remapping — the prompt removes the ambiguity
// instead of having post-processing patch it up.
export function buildPrompt(goal: string, hits: FtsHit[]): string {
  const lines = hits.map(h =>
    `- id: ${h.id}\n  ${h.name} (${h.source_type}, ${h.installed ? "installed" : "gap"})\n  ${h.description ?? "(no description)"}`
  ).join("\n");
  return `Goal: ${goal}

Candidates:
${lines}

Return JSON with shape:
{"ranked":[{"id":"<exact id from list>","score":0-100,"why":"<one sentence>"}],"stop_reason":"all_relevant"|"low_confidence"|"exhausted"}

Return at most the top ${MAX_RANKED} ranked items. The id MUST be one of the ids listed above, copied verbatim. Only respond with JSON.`;
}

const JSON_BLOCK = /\{[\s\S]*\}/;

function isRankedItem(r: unknown): r is RankedItem {
  if (r == null || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.score === "number" && typeof o.why === "string";
}

export function parseRerankResponse(text: string): RerankResult | null {
  const m = text.match(JSON_BLOCK);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (!Array.isArray(obj.ranked) || !obj.ranked.every(isRankedItem)) return null;
    if (!VALID_STOP_REASONS.includes(obj.stop_reason)) return null;
    return { ranked: obj.ranked, stop_reason: obj.stop_reason };
  } catch { return null; }
}

function textOf(resp: Message): string {
  return resp.content.filter(b => b.type === "text").map(b => b.text).join("");
}

export async function rerank(goal: string, hits: FtsHit[]): Promise<RerankResult | null> {
  const client = new Anthropic();
  const prompt = buildPrompt(goal, hits);
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    let result = parseRerankResponse(textOf(resp));
    if (!result) {
      // retry once with same prompt — model is usually deterministic on retry
      // for shape errors. Persistent failure → return null (caller degrades).
      const retry = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
      });
      result = parseRerankResponse(textOf(retry));
      if (!result) console.warn("[quartermaster] rerank failed after retry; degrading to FTS-only");
    }
    return result;
  } catch {
    return null;
  }
}
