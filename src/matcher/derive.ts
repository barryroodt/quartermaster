import type { SourceType } from "../inventory/types.ts";

export function deriveBundleKind(bundleId: string | null): "plugin" | "marketplace" | null {
  if (!bundleId) return null;
  return bundleId.includes("@") ? "plugin" : "marketplace";
}

export interface Invocation { style: string; name?: string; example?: string; cmd?: string; subagent_type?: string; load_tools_via?: string }

export function deriveInvocation(sourceType: SourceType, canonicalName: string): Invocation {
  switch (sourceType) {
    case "skill":      return { style: "skill", name: canonicalName };
    case "command":    return { style: "slash", name: "/" + canonicalName };
    case "mcp_tool":   return { style: "tool", name: canonicalName };
    case "mcp_server": return { style: "server", name: canonicalName, load_tools_via: "ToolSearch" };
    case "agent":      return { style: "agent", subagent_type: canonicalName };
    case "cli":        return { style: "bash", example: canonicalName.replace(/^bin:/, "") };
    case "plugin":     return { style: "install", cmd: `claude plugin install ${canonicalName}` };
  }
}
