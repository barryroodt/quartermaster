import type { SourceType } from "../inventory/types.ts";

// Narrowed from inventory's SourceType: commands/agents/mcp_tools are
// inventory-discovered, not installer-installed. Extract<> keeps the two
// in lockstep — renaming a SourceType member breaks here at tsc time.
export type InstallableSourceType = Extract<SourceType, "plugin" | "skill" | "mcp_server" | "cli">;

export interface InstallContext {
  capability_id: string;
  canonical_name: string;
  source_type: InstallableSourceType;
  source_url?: string;
  registry?: "skills.sh" | "brew" | "npm" | "cargo" | "raw" | "claude-marketplace";
}

// What an installer returns. trust_action is NOT here — that belongs to the
// orchestration layer (Task 22 hook + Task 18 prompts), which composes
// InstallResult from InstallOutcome + its own trust decision.
export interface InstallOutcome {
  capability_id: string;
  status: "installed" | "skipped" | "blocked" | "failed";
  source_sha: string | null;
  verified: boolean;
  files: string[];
  errors: string[];
}

export interface InstallResult extends InstallOutcome {
  trust_action: "auto-trusted" | "user-confirm" | "promoted-org" | "promoted-repo" | "none";
}
