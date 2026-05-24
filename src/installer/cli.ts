import type { InstallContext, InstallOutcome } from "./types.ts";

export interface CliArgs extends InstallContext { command: string }

// CLI installs are never auto-run — we surface the command for the user to
// run manually. Async for surface consistency with the other installers
// (callers can Promise.all across the set without special-casing CLI).
export async function installCli(args: CliArgs): Promise<InstallOutcome> {
  return {
    capability_id: args.capability_id,
    status: "skipped",
    source_sha: null,
    verified: false,
    files: [],
    errors: [`To install, run manually: ${args.command}`],
  };
}
