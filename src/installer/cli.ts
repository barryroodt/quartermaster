import type { InstallContext, InstallResult } from "./types.ts";

export interface CliArgs extends InstallContext { command: string }

export function installCli(args: CliArgs): InstallResult {
  // CLI installs are never auto-run. We return a "skipped" status with a hint command for the user.
  return {
    capability_id: args.capability_id,
    status: "skipped",
    source_sha: null,
    trust_action: "none",
    verified: false,
    files: [],
    errors: [`To install, run manually: ${args.command}`],
  };
}
