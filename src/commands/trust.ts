import { loadTrust, saveTrust, type TrustConfig } from "../trust/derive.ts";
import { validatePattern } from "../trust/patterns.ts";

export function runTrustAdd(trustPath: string, pattern: string): void {
  validatePattern(pattern);
  const cfg = loadTrust(trustPath);
  if (!cfg.trusted_patterns.includes(pattern)) cfg.trusted_patterns.push(pattern);
  saveTrust(trustPath, cfg);
}

export function runTrustList(trustPath: string): TrustConfig {
  return loadTrust(trustPath);
}
