import Anthropic from "@anthropic-ai/sdk";
import type { FtsHit } from "./fts.ts";

export interface RankedItem { id: string; score: number; why: string }
export type StopReason = "all_relevant" | "low_confidence" | "exhausted";
export interface RerankResult { ranked: RankedItem[]; stop_reason: StopReason }

export function buildPrompt(goal: string, hits: FtsHit[]): string {
  const lines = hits.map((h, i) =>
    `[${i + 1}] ${h.name} (${h.source_type}, ${h.installed ? "installed" : "gap"})\n    ${h.description ?? "(no description)"}`
  ).join("\n");
  return `Goal: ${goal}\n\nCandidates:\n${lines}\n\nReturn JSON with shape:\n{"ranked":[{"id":"<id>","score":0-100,"why":"<one sentence>"}],"stop_reason":"all_relevant"|"low_confidence"|"exhausted"}\n\nReturn at most the top 5 ranked items. Only respond with JSON.`;
}

const JSON_BLOCK = /\{[\s\S]*\}/;

export function parseRerankResponse(text: string): RerankResult | null {
  const m = text.match(JSON_BLOCK);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (!Array.isArray(obj.ranked) || !obj.stop_reason) return null;
    return obj as RerankResult;
  } catch { return null; }
}

export async function rerank(goal: string, hits: FtsHit[], idsByIndex: Map<number, string>): Promise<RerankResult | null> {
  const client = new Anthropic();
  const prompt = buildPrompt(goal, hits);
  try {
    const resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: "You rank capabilities by relevance to a user's coding goal. Output strict JSON only.",
      messages: [{ role: "user", content: prompt }],
    });
    const text = resp.content.filter(b => b.type === "text").map(b => (b as { type: "text"; text: string }).text).join("");
    let result = parseRerankResponse(text);
    if (!result) {
      // retry once
      const retry = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: "You rank capabilities. Respond ONLY with strict JSON, no preamble.",
        messages: [{ role: "user", content: prompt }],
      });
      const retryText = retry.content.filter(b => b.type === "text").map(b => (b as { type: "text"; text: string }).text).join("");
      result = parseRerankResponse(retryText);
    }
    // map index-style ids if present
    if (result) {
      for (const r of result.ranked) {
        const idx = parseInt(r.id, 10);
        if (!isNaN(idx) && idsByIndex.has(idx)) r.id = idsByIndex.get(idx)!;
      }
    }
    return result;
  } catch {
    return null;
  }
}
