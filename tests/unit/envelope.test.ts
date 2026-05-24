import { describe, expect, test } from "bun:test";
import { extractPrompt } from "../../src/hooks/envelope";

describe("extractPrompt", () => {
  test("extracts prompt field from Claude Code envelope", () => {
    const raw = JSON.stringify({
      session_id: "abc",
      transcript_path: "/Users/x/.claude/projects/kubernetes-stuff/log.jsonl",
      cwd: "/Users/x/projects/react-app",
      hook_event_name: "UserPromptSubmit",
      prompt: "what time is it",
    });
    expect(extractPrompt(raw)).toBe("what time is it");
  });

  test("falls back to raw text when not JSON", () => {
    expect(extractPrompt("plain prompt text")).toBe("plain prompt text");
  });

  test("falls back to raw text on malformed JSON", () => {
    expect(extractPrompt("{not valid json")).toBe("{not valid json");
  });

  test("falls back to raw when JSON lacks prompt field", () => {
    const raw = JSON.stringify({ session_id: "x", cwd: "/tmp" });
    expect(extractPrompt(raw)).toBe(raw);
  });

  test("falls back to raw when prompt field is non-string", () => {
    const raw = JSON.stringify({ prompt: 42 });
    expect(extractPrompt(raw)).toBe(raw);
  });

  test("handles leading/trailing whitespace", () => {
    const raw = `\n  ${JSON.stringify({ prompt: "hello" })}  \n`;
    expect(extractPrompt(raw)).toBe("hello");
  });

  test("isolation from envelope metadata — cwd containing keywords does NOT leak into prompt", () => {
    const raw = JSON.stringify({
      cwd: "/Users/x/projects/postgres-kubernetes-react",
      prompt: "what time is it",
    });
    const extracted = extractPrompt(raw);
    expect(extracted).toBe("what time is it");
    expect(extracted).not.toContain("postgres");
    expect(extracted).not.toContain("kubernetes");
    expect(extracted).not.toContain("react");
  });
});
