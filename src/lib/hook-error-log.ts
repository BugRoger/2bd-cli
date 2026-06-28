import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

interface LogOptions {
  now?: Date;
}

export async function logHookError(
  cwd: string,
  message: string,
  context?: Record<string, string | number | boolean | undefined>,
  options?: LogOptions
): Promise<void> {
  try {
    const now = options?.now ?? new Date();
    const ts = now.toISOString();

    const ctxPairs: string[] = [];
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        if (v === undefined) continue;
        ctxPairs.push(`${k}=${v}`);
      }
    }
    const ctxSuffix = ctxPairs.length > 0 ? ` {${ctxPairs.join(", ")}}` : "";

    const line = `${ts} ${message}${ctxSuffix}\n`;
    const dir = join(cwd, ".2b", "state");
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "hook-errors.log"), line);
  } catch {
    // best-effort: swallow
  }
}
