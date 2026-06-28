import { open, stat } from "node:fs/promises";

export interface ParsedTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ReadResult {
  turns: ParsedTurn[];
  newByteOffset: number;
}

type LogFn = (message: string, context?: Record<string, string | number>) => void;

interface ContentBlock {
  type: string;
  text?: string;
}

interface TranscriptEntry {
  type?: string;
  message?: {
    role?: string;
    content?: ContentBlock[] | string;
  };
}

export async function readTranscriptSlice(
  transcriptPath: string,
  startOffset: number,
  logError: LogFn
): Promise<ReadResult> {
  let size: number;
  try {
    const s = await stat(transcriptPath);
    size = s.size;
  } catch (err) {
    logError("transcript not found", {
      transcript_path: transcriptPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return { turns: [], newByteOffset: startOffset };
  }

  if (startOffset >= size) {
    return { turns: [], newByteOffset: size };
  }

  const fh = await open(transcriptPath, "r");
  try {
    const length = size - startOffset;
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, startOffset);
    const text = buf.toString("utf-8");

    const turns: ParsedTurn[] = [];
    const rawLines = text.split("\n");
    // If the slice ends with "\n", the last element is "". If it does not, that last
    // element is a partial line we should leave for the next invocation.
    let consumedBytes = 0;
    const endsWithNewline = text.endsWith("\n");
    const lineCount = endsWithNewline ? rawLines.length - 1 : rawLines.length - 1;
    // Iterate completed lines only (all but possibly the last partial).
    for (let i = 0; i < lineCount; i++) {
      const line = rawLines[i];
      consumedBytes += Buffer.byteLength(line, "utf-8") + 1; // +1 for "\n"
      if (line.length === 0) continue;

      let entry: TranscriptEntry;
      try {
        entry = JSON.parse(line) as TranscriptEntry;
      } catch (err) {
        logError("malformed transcript line; skipping", {
          transcript_path: transcriptPath,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      const turn = extractTurn(entry);
      if (turn !== null) turns.push(turn);
    }

    return { turns, newByteOffset: startOffset + consumedBytes };
  } finally {
    await fh.close();
  }
}

function extractTurn(entry: TranscriptEntry): ParsedTurn | null {
  if (entry.type !== "user" && entry.type !== "assistant") return null;
  const message = entry.message;
  if (!message) return null;

  const content = message.content;
  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block && block.type === "text" && typeof block.text === "string") {
        text += block.text;
      }
    }
  }

  if (text.length === 0) return null;
  return { role: entry.type, content: text };
}
