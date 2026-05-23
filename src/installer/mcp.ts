import { $ } from "bun";
import type { InstallContext, InstallResult } from "./types.ts";

export interface McpArgs extends InstallContext {
  transport_args: string[];
}

export async function installMcp(args: McpArgs): Promise<InstallResult> {
  const result: InstallResult = {
    capability_id: args.capability_id, status: "failed", source_sha: null, trust_action: "none",
    verified: false, files: [], errors: [],
  };
  try {
    const proc = await $`claude mcp add ${args.canonical_name} ${{ raw: args.transport_args.join(" ") }}`.quiet().nothrow();
    if (proc.exitCode !== 0) {
      result.errors.push(proc.stderr.toString());
      return result;
    }
    const list = await $`claude mcp list`.quiet().nothrow();
    if (list.stdout.toString().includes(args.canonical_name)) {
      result.status = "installed";
      result.verified = true;
    } else {
      result.errors.push("server not listed after add");
    }
  } catch (e) {
    result.errors.push(String(e));
  }
  return result;
}
