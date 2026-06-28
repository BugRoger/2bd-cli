import { logHookError } from "../lib/hook-error-log.js";
import { loadCursorStore, saveCursorStore } from "../lib/cursor-store.js";
import { readTranscriptSlice } from "../lib/read-transcript.js";
import { appendTurnsToDailyLog } from "../lib/daily-log.js";

interface StopPayload {
  session_id: string;
  transcript_path: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function validatePayload(raw: unknown): StopPayload | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.session_id !== "string" || obj.session_id.length === 0) return null;
  if (typeof obj.transcript_path !== "string" || obj.transcript_path.length === 0) return null;
  return { session_id: obj.session_id, transcript_path: obj.transcript_path };
}

export async function stopAction(): Promise<void> {
  if (process.env.TWOBD_HOOK_DISABLED === "1") {
    return;
  }

  const cwd = process.cwd();

  try {
    const stdinText = await readStdin();

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdinText);
    } catch (err) {
      await logHookError(cwd, "stop hook stdin payload was not valid JSON", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const payload = validatePayload(parsed);
    if (payload === null) {
      await logHookError(cwd, "stop hook payload missing required fields", {
        keys: Object.keys((parsed as Record<string, unknown>) ?? {}).join("|"),
      });
      return;
    }

    const store = await loadCursorStore(cwd);
    const prior = store[payload.session_id];
    const startOffset =
      prior && prior.transcript_path === payload.transcript_path ? prior.byte_offset : 0;

    const sliceResult = await readTranscriptSlice(
      payload.transcript_path,
      startOffset,
      (message, context) => {
        void logHookError(cwd, message, {
          session_id: payload.session_id,
          ...(context ?? {}),
        });
      }
    );

    if (sliceResult.turns.length > 0) {
      await appendTurnsToDailyLog(cwd, sliceResult.turns, {
        session_id: payload.session_id,
      });
    }

    store[payload.session_id] = {
      transcript_path: payload.transcript_path,
      byte_offset: sliceResult.newByteOffset,
      last_updated_iso: new Date().toISOString(),
    };
    await saveCursorStore(cwd, store);
  } catch (err) {
    await logHookError(cwd, "uncaught error in stop hook", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
