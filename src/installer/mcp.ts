import { $ } from "bun";
import { runInstaller, InstallFailed } from "./run.ts";
import type { InstallContext, InstallOutcome } from "./types.ts";

export interface McpArgs extends InstallContext {
  transport_args: string[];
}

export function installMcp(args: McpArgs): Promise<InstallOutcome> {
  return runInstaller(args, async (a) => {
    // Pass transport_args as an array directly — Bun's $ quotes each element.
    // Previously used `{ raw: args.transport_args.join(" ") }` which disabled
    // escaping and was a real shell-injection hole for any arg containing
    // metacharacters (e.g. `--url "https://x;rm -rf ~"`).
    const proc = await $`claude mcp add ${a.canonical_name} ${a.transport_args}`.quiet().nothrow();
    if (proc.exitCode !== 0) throw new InstallFailed(proc.stderr.toString());

    const list = await $`claude mcp list`.quiet().nothrow();
    if (!list.stdout.toString().includes(a.canonical_name)) {
      throw new InstallFailed("server not listed after add");
    }

    return { status: "installed", source_sha: null, files: [], verified: true };
  });
}
