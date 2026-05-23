export interface InstallContext {
  capability_id: string;
  canonical_name: string;
  source_type: "plugin" | "skill" | "mcp_server" | "cli";
  source_url?: string;
  registry?: "skills.sh" | "brew" | "npm" | "cargo" | "raw" | "claude-marketplace";
}

export interface InstallResult {
  capability_id: string;
  status: "installed" | "skipped" | "blocked" | "failed";
  source_sha: string | null;
  trust_action: "auto-trusted" | "user-confirm" | "promoted-org" | "promoted-repo" | "none";
  verified: boolean;
  files: string[];
  errors: string[];
}
