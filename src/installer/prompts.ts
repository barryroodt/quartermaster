export interface UntrustedCtx { canonical: string; source_url: string; source_sha: string }
export function formatUntrustedPrompt(ctx: UntrustedCtx): string {
  return `⚠ Untrusted source: ${ctx.source_url}\n  Capability: ${ctx.canonical}\n  SHA: ${ctx.source_sha}\nInstall? [y/N]`;
}

export interface DriftCtx { canonical: string; pinned_sha: string; current_sha: string; source_url: string }
export function formatDriftPrompt(ctx: DriftCtx): string {
  return `⚠ Pin drift detected for ${ctx.canonical}\n  Pinned:  ${ctx.pinned_sha}\n  Latest:  ${ctx.current_sha}\n  Diff:    ${ctx.source_url}/compare/${ctx.pinned_sha}...${ctx.current_sha}\n\nUpdate pin to latest? [y/N]`;
}

export interface PromoteCtx { owner: string; repo: string }
export function formatPromotePrompt(ctx: PromoteCtx): string {
  return `Install successful from untrusted source.\nSource github.com/${ctx.owner} is not in your trusted_patterns. Add to allowlist?\n\n  (1) Yes, trust ${ctx.owner}/*           (whole org)\n  (2) Yes, trust ${ctx.owner}/${ctx.repo} only\n  (3) No, keep prompting          (default)\n\n[1/2/3]`;
}

export type PromoteChoice = "promote-org" | "promote-repo" | "keep-prompting";
export function parsePromoteChoice(input: string): PromoteChoice {
  const trimmed = input.trim();
  if (trimmed === "1") return "promote-org";
  if (trimmed === "2") return "promote-repo";
  return "keep-prompting";
}
