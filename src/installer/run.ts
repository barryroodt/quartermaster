import type { InstallContext, InstallOutcome } from "./types.ts";

// Thrown by install steps to signal a clean, expected failure. runInstaller
// converts to errors[]. Anything else thrown (TypeError, network blowup) also
// lands in errors[] via String(e) — InstallFailed is the explicit path.
export class InstallFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallFailed";
  }
}

// A step returns the success outcome fields. Failure = throw InstallFailed.
// runInstaller handles status/error boilerplate + the capability_id base —
// step bodies stay pure.
export type InstallStep<T extends InstallContext> = (ctx: T) => Promise<Omit<InstallOutcome, "capability_id" | "errors">>;

export async function runInstaller<T extends InstallContext>(
  ctx: T,
  step: InstallStep<T>,
): Promise<InstallOutcome> {
  const base: InstallOutcome = {
    capability_id: ctx.capability_id,
    status: "failed",
    source_sha: null,
    verified: false,
    files: [],
    errors: [],
  };
  try {
    return { ...base, ...(await step(ctx)) };
  } catch (e) {
    return { ...base, errors: [e instanceof Error ? e.message : String(e)] };
  }
}
