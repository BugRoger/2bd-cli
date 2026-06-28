import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic-write.js";
import { logHookError } from "./hook-error-log.js";

export interface CursorRecord {
  transcript_path: string;
  byte_offset: number;
  last_updated_iso: string;
}

export interface CursorStore {
  [sessionId: string]: CursorRecord;
}

function cursorsFilePath(cwd: string): string {
  return join(cwd, ".2b", "state", "cursors.json");
}

export async function loadCursorStore(cwd: string): Promise<CursorStore> {
  const path = cursorsFilePath(cwd);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      await logHookError(cwd, "cursors.json had unexpected shape; resetting", { path });
      return {};
    }
    return parsed as CursorStore;
  } catch (err) {
    await logHookError(cwd, "cursors.json malformed; resetting", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}

export async function saveCursorStore(cwd: string, store: CursorStore): Promise<void> {
  const path = cursorsFilePath(cwd);
  await atomicWriteFile(path, JSON.stringify(store, null, 2));
}
