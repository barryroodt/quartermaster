// Claude Code UserPromptSubmit hook sends a JSON envelope on stdin:
//   { session_id, transcript_path, cwd, hook_event_name, prompt }
// Older direct-pipe smoke tests pipe raw text. Both must work.
//
// Parsing the envelope avoids classifier false positives from tokens in
// cwd / transcript_path matching tech keywords (e.g. user in
// ~/projects/kubernetes-stuff would otherwise trigger on every prompt).

export interface HookEnvelope {
  prompt?: unknown;
  cwd?: unknown;
  session_id?: unknown;
  transcript_path?: unknown;
  hook_event_name?: unknown;
}

export function extractPrompt(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return raw;
  try {
    const env = JSON.parse(trimmed) as HookEnvelope;
    if (typeof env.prompt === "string") return env.prompt;
    return raw;
  } catch {
    return raw;
  }
}
