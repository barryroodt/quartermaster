import { existsSync, readFileSync } from "node:fs";

export async function loadJsonOrAsync<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await Bun.file(path).text()) as T; }
  catch { return fallback; }
}

export function loadJsonOr<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")) as T; }
  catch { return fallback; }
}
