import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTranscriptSlice, type ParsedTurn } from "../../src/lib/read-transcript.js";

function userTurn(text: string): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

function assistantTurn(text: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

function mixedAssistant(): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "secret" },
        { type: "text", text: "hello " },
        { type: "tool_use", id: "t1", name: "Read", input: {} },
        { type: "text", text: "world" },
      ],
    },
  });
}

function toolResultEnvelope(): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ignored" }] },
  });
}

describe("readTranscriptSlice", () => {
  let tmpDir: string;
  let path: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-readtx-"));
    path = join(tmpDir, "transcript.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns no turns and offset 0 for a missing file", async () => {
    const errors: string[] = [];
    const result = await readTranscriptSlice(
      join(tmpDir, "nope.jsonl"),
      0,
      (m) => { errors.push(m); }
    );
    expect(result.turns).toEqual([]);
    expect(result.newByteOffset).toBe(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("parses user and assistant text turns from offset 0", async () => {
    const lines = [userTurn("hi"), assistantTurn("there")];
    await writeFile(path, lines.map((l) => l + "\n").join(""));
    const result = await readTranscriptSlice(path, 0, () => {});
    const roles = result.turns.map((t: ParsedTurn) => t.role);
    const contents = result.turns.map((t: ParsedTurn) => t.content);
    expect(roles).toEqual(["user", "assistant"]);
    expect(contents).toEqual(["hi", "there"]);
    expect(result.newByteOffset).toBe(Buffer.byteLength(lines.map((l) => l + "\n").join(""), "utf-8"));
  });

  it("starts scanning from a non-zero byte offset", async () => {
    const first = userTurn("first") + "\n";
    const second = assistantTurn("second") + "\n";
    await writeFile(path, first + second);
    const startOffset = Buffer.byteLength(first, "utf-8");
    const result = await readTranscriptSlice(path, startOffset, () => {});
    expect(result.turns.map((t) => t.content)).toEqual(["second"]);
    expect(result.newByteOffset).toBe(Buffer.byteLength(first + second, "utf-8"));
  });

  it("returns no turns when offset is at or past EOF", async () => {
    const body = userTurn("once") + "\n";
    await writeFile(path, body);
    const eofOffset = Buffer.byteLength(body, "utf-8");
    const result = await readTranscriptSlice(path, eofOffset, () => {});
    expect(result.turns).toEqual([]);
    expect(result.newByteOffset).toBe(eofOffset);
  });

  it("drops tool_use, tool_result, and thinking blocks; keeps concatenated text", async () => {
    await writeFile(path, mixedAssistant() + "\n");
    const result = await readTranscriptSlice(path, 0, () => {});
    expect(result.turns.length).toBe(1);
    expect(result.turns[0].role).toBe("assistant");
    expect(result.turns[0].content).toBe("hello world");
  });

  it("skips user envelopes that contain only tool_result blocks", async () => {
    const lines = [assistantTurn("a"), toolResultEnvelope(), assistantTurn("b")];
    await writeFile(path, lines.map((l) => l + "\n").join(""));
    const result = await readTranscriptSlice(path, 0, () => {});
    expect(result.turns.map((t) => t.content)).toEqual(["a", "b"]);
  });

  it("skips a malformed JSONL line, continues, and logs an error", async () => {
    const lines = [assistantTurn("before"), "{not valid", assistantTurn("after")];
    await writeFile(path, lines.map((l) => l + "\n").join(""));
    const errors: string[] = [];
    const result = await readTranscriptSlice(path, 0, (m) => { errors.push(m); });
    expect(result.turns.map((t) => t.content)).toEqual(["before", "after"]);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("ignores entries with unsupported top-level type values", async () => {
    const summary = JSON.stringify({ type: "summary", summary: "ignored" });
    const lines = [summary, assistantTurn("kept")];
    await writeFile(path, lines.map((l) => l + "\n").join(""));
    const result = await readTranscriptSlice(path, 0, () => {});
    expect(result.turns.map((t) => t.content)).toEqual(["kept"]);
  });

  it("ignores a trailing empty line", async () => {
    await writeFile(path, assistantTurn("only") + "\n\n");
    const result = await readTranscriptSlice(path, 0, () => {});
    expect(result.turns.map((t) => t.content)).toEqual(["only"]);
  });
});
