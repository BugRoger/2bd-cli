import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic-write.js";

export interface TurnInput {
  role: "user" | "assistant";
  content: string;
}

export interface AppendOptions {
  session_id: string;
  now?: Date;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function localDateString(now: Date): string {
  const yyyy = now.getFullYear().toString().padStart(4, "0");
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

export function dailyLogPath(cwd: string, now: Date = new Date()): string {
  return join(cwd, ".2b", "state", "sessions", `${localDateString(now)}.jsonl`);
}

export async function appendTurnsToDailyLog(
  cwd: string,
  turns: TurnInput[],
  options: AppendOptions
): Promise<void> {
  if (turns.length === 0) return;

  const now = options.now ?? new Date();
  const path = dailyLogPath(cwd, now);
  const ts = now.toISOString();

  let existing = "";
  try {
    existing = await readFile(path, "utf-8");
  } catch {
    // missing file is fine
  }

  const newLines = turns
    .map((t) =>
      JSON.stringify({
        ts,
        session_id: options.session_id,
        role: t.role,
        content: t.content,
      })
    )
    .join("\n");

  const next = existing.length === 0 ? newLines + "\n" : existing + newLines + "\n";
  await atomicWriteFile(path, next);
}
