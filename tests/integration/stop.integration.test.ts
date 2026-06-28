import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../src/cli.ts");

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runStopHook(
  cwd: string,
  stdinPayload: string,
  extraEnv: Record<string, string> = {}
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn("bun", ["run", CLI_PATH, "hooks", "stop"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    proc.on("error", (err) => reject(err));

    proc.stdin.write(stdinPayload);
    proc.stdin.end();
  });
}

async function createVault(base: string): Promise<void> {
  await mkdir(join(base, ".2b", "system"), { recursive: true });
}

function userTurnLine(text: string): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

function assistantTurnLine(text: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

function mixedAssistantTurnLine(): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "internal reasoning that must not leak" },
        { type: "text", text: "visible answer part one. " },
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/x" } },
        { type: "text", text: "visible answer part two." },
      ],
    },
  });
}

function toolResultUserEnvelope(): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "file body" }],
    },
  });
}

async function writeTranscript(path: string, lines: string[]): Promise<void> {
  await writeFile(path, lines.map((l) => l + "\n").join(""));
}

function todayLocalDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear().toString().padStart(4, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dailyLogPath(cwd: string): string {
  return join(cwd, ".2b", "state", "sessions", `${todayLocalDate()}.jsonl`);
}

function cursorsPath(cwd: string): string {
  return join(cwd, ".2b", "state", "cursors.json");
}

function errorLogPath(cwd: string): string {
  return join(cwd, ".2b", "state", "hook-errors.log");
}

async function readJsonlEntries(path: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(path, "utf-8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("CLI integration: hooks stop — capture pipeline", () => {
  let tmpDir: string;
  let transcriptPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-stop-test-"));
    await createVault(tmpDir);
    transcriptPath = join(tmpDir, "transcript.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("Scenario: a completed assistant turn is appended to today's daily log", () => {
    it("appends one entry per user/assistant turn with ts, session_id, role, content", async () => {
      await writeTranscript(transcriptPath, [
        userTurnLine("hello"),
        assistantTurnLine("hi there"),
      ]);

      const payload = JSON.stringify({ session_id: "sess-1", transcript_path: transcriptPath });
      const { exitCode } = await runStopHook(tmpDir, payload);

      expect(exitCode).toBe(0);
      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      expect(entries.length).toBe(2);
      expect(entries[0]).toMatchObject({ session_id: "sess-1", role: "user", content: "hello" });
      expect(entries[1]).toMatchObject({ session_id: "sess-1", role: "assistant", content: "hi there" });
      expect(typeof entries[0].ts).toBe("string");
      expect((entries[0].ts as string).length).toBeGreaterThan(0);
    });
  });

  describe("Scenario: only text content is captured; tool and reasoning blocks are dropped", () => {
    it("emits only the concatenated text portion of an assistant turn", async () => {
      await writeTranscript(transcriptPath, [mixedAssistantTurnLine()]);

      const payload = JSON.stringify({ session_id: "sess-mixed", transcript_path: transcriptPath });
      const { exitCode } = await runStopHook(tmpDir, payload);

      expect(exitCode).toBe(0);
      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      expect(entries.length).toBe(1);
      expect(entries[0].content).toBe("visible answer part one. visible answer part two.");
      expect(entries[0].content).not.toMatch(/internal reasoning/);
      expect(entries[0].content).not.toMatch(/tool_use/);
      expect(entries[0].content).not.toMatch(/Read/);
    });

    it("skips user envelopes whose content is only tool_result blocks", async () => {
      await writeTranscript(transcriptPath, [
        assistantTurnLine("answer one"),
        toolResultUserEnvelope(),
        assistantTurnLine("answer two"),
      ]);

      const payload = JSON.stringify({ session_id: "sess-tool", transcript_path: transcriptPath });
      const { exitCode } = await runStopHook(tmpDir, payload);

      expect(exitCode).toBe(0);
      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      expect(entries.length).toBe(2);
      expect(entries[0].content).toBe("answer one");
      expect(entries[1].content).toBe("answer two");
    });
  });

  describe("Scenario: the daily log path uses the local calendar date", () => {
    it("writes to .2b/state/sessions/YYYY-MM-DD.jsonl with today's local date", async () => {
      await writeTranscript(transcriptPath, [assistantTurnLine("local-date check")]);

      const payload = JSON.stringify({ session_id: "sess-date", transcript_path: transcriptPath });
      const { exitCode } = await runStopHook(tmpDir, payload);

      expect(exitCode).toBe(0);
      expect(await fileExists(dailyLogPath(tmpDir))).toBe(true);
    });
  });

  describe("Scenario: the state area is created on first capture when absent", () => {
    it("lazily creates .2b/state/sessions/ when missing", async () => {
      await writeTranscript(transcriptPath, [assistantTurnLine("first ever turn")]);
      expect(await fileExists(join(tmpDir, ".2b", "state"))).toBe(false);

      const payload = JSON.stringify({ session_id: "sess-fresh", transcript_path: transcriptPath });
      const { exitCode } = await runStopHook(tmpDir, payload);

      expect(exitCode).toBe(0);
      expect(await fileExists(join(tmpDir, ".2b", "state"))).toBe(true);
      expect(await fileExists(dailyLogPath(tmpDir))).toBe(true);
    });
  });

  describe("Scenario Outline: successive Stop invocations append only newly produced turns", () => {
    const cases: Array<{ firstBatch: number; secondBatch: number; total: number }> = [
      { firstBatch: 1, secondBatch: 1, total: 2 },
      { firstBatch: 3, secondBatch: 2, total: 5 },
      { firstBatch: 5, secondBatch: 0, total: 5 },
    ];

    for (const { firstBatch, secondBatch, total } of cases) {
      it(`first=${firstBatch} second=${secondBatch} total=${total}`, async () => {
        const firstLines: string[] = [];
        for (let i = 0; i < firstBatch; i++) firstLines.push(assistantTurnLine(`first-${i}`));
        await writeTranscript(transcriptPath, firstLines);

        const payload1 = JSON.stringify({ session_id: "sess-out", transcript_path: transcriptPath });
        const r1 = await runStopHook(tmpDir, payload1);
        expect(r1.exitCode).toBe(0);

        const allLines = [...firstLines];
        for (let i = 0; i < secondBatch; i++) allLines.push(assistantTurnLine(`second-${i}`));
        await writeTranscript(transcriptPath, allLines);

        const r2 = await runStopHook(tmpDir, payload1);
        expect(r2.exitCode).toBe(0);

        const entries = await readJsonlEntries(dailyLogPath(tmpDir));
        expect(entries.length).toBe(total);
        const contents = entries.map((e) => e.content as string);
        const dedup = new Set(contents);
        expect(dedup.size).toBe(total);
      });
    }
  });

  describe("Scenario: Stop hook short-circuits when the recursion guard sentinel is set", () => {
    it("does nothing and exits 0 when TWOBD_HOOK_DISABLED=1", async () => {
      await writeTranscript(transcriptPath, [assistantTurnLine("should be ignored")]);

      const payload = JSON.stringify({ session_id: "sess-guard", transcript_path: transcriptPath });
      const { exitCode } = await runStopHook(tmpDir, payload, { TWOBD_HOOK_DISABLED: "1" });

      expect(exitCode).toBe(0);
      expect(await fileExists(dailyLogPath(tmpDir))).toBe(false);
      expect(await fileExists(cursorsPath(tmpDir))).toBe(false);
    });
  });

  describe("Scenario: concurrent Stop invocations on the same day never produce a malformed daily log", () => {
    it("two parallel invocations result in well-formed JSONL", async () => {
      const transcriptA = join(tmpDir, "transcript-a.jsonl");
      const transcriptB = join(tmpDir, "transcript-b.jsonl");
      await writeTranscript(transcriptA, [assistantTurnLine("from-a")]);
      await writeTranscript(transcriptB, [assistantTurnLine("from-b")]);

      const payloadA = JSON.stringify({ session_id: "sess-a", transcript_path: transcriptA });
      const payloadB = JSON.stringify({ session_id: "sess-b", transcript_path: transcriptB });

      const [ra, rb] = await Promise.all([
        runStopHook(tmpDir, payloadA),
        runStopHook(tmpDir, payloadB),
      ]);
      expect(ra.exitCode).toBe(0);
      expect(rb.exitCode).toBe(0);

      const raw = await readFile(dailyLogPath(tmpDir), "utf-8");
      const lines = raw.split("\n").filter((l) => l.length > 0);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });
  });

  describe("Scenario: reopening a session resumes capture from the prior cursor position", () => {
    it("does not duplicate prior turns when invoked again after extending the transcript", async () => {
      await writeTranscript(transcriptPath, [
        assistantTurnLine("turn-1"),
        assistantTurnLine("turn-2"),
      ]);
      const payload = JSON.stringify({ session_id: "sess-resume", transcript_path: transcriptPath });
      const r1 = await runStopHook(tmpDir, payload);
      expect(r1.exitCode).toBe(0);

      await writeTranscript(transcriptPath, [
        assistantTurnLine("turn-1"),
        assistantTurnLine("turn-2"),
        assistantTurnLine("turn-3"),
      ]);
      const r2 = await runStopHook(tmpDir, payload);
      expect(r2.exitCode).toBe(0);

      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      const contents = entries.map((e) => e.content as string);
      expect(contents).toEqual(["turn-1", "turn-2", "turn-3"]);
    });
  });

  describe("Scenario: each tracked session has an independent cursor", () => {
    it("advancing one cursor does not change the other", async () => {
      const transcriptA = join(tmpDir, "transcript-a.jsonl");
      const transcriptB = join(tmpDir, "transcript-b.jsonl");
      await writeTranscript(transcriptA, [assistantTurnLine("a1")]);
      await writeTranscript(transcriptB, [assistantTurnLine("b1")]);

      await runStopHook(tmpDir, JSON.stringify({ session_id: "sess-a", transcript_path: transcriptA }));
      await runStopHook(tmpDir, JSON.stringify({ session_id: "sess-b", transcript_path: transcriptB }));

      const cursorsAfterFirst = JSON.parse(await readFile(cursorsPath(tmpDir), "utf-8"));
      const offsetBBefore = cursorsAfterFirst["sess-b"].byte_offset;

      await writeTranscript(transcriptA, [assistantTurnLine("a1"), assistantTurnLine("a2")]);
      await runStopHook(tmpDir, JSON.stringify({ session_id: "sess-a", transcript_path: transcriptA }));

      const cursorsAfterSecond = JSON.parse(await readFile(cursorsPath(tmpDir), "utf-8"));
      expect(cursorsAfterSecond["sess-b"].byte_offset).toBe(offsetBBefore);
      expect(cursorsAfterSecond["sess-a"].byte_offset).toBeGreaterThan(cursorsAfterFirst["sess-a"].byte_offset);
    });
  });

  describe("Scenario: a missing transcript path is logged and does not break the session", () => {
    it("exits 0 and writes an entry to hook-errors.log when transcript is missing", async () => {
      const missing = join(tmpDir, "does-not-exist.jsonl");
      const payload = JSON.stringify({ session_id: "sess-missing", transcript_path: missing });
      const { exitCode } = await runStopHook(tmpDir, payload);
      expect(exitCode).toBe(0);
      expect(await fileExists(dailyLogPath(tmpDir))).toBe(false);
      expect(await fileExists(errorLogPath(tmpDir))).toBe(true);
      const errs = await readFile(errorLogPath(tmpDir), "utf-8");
      expect(errs.length).toBeGreaterThan(0);
    });
  });

  describe("Scenario: a malformed payload is logged and does not break the session", () => {
    it("exits 0 and writes a parse-error entry to hook-errors.log", async () => {
      const { exitCode } = await runStopHook(tmpDir, "this is not json");
      expect(exitCode).toBe(0);
      expect(await fileExists(errorLogPath(tmpDir))).toBe(true);
      const errs = await readFile(errorLogPath(tmpDir), "utf-8");
      expect(errs.length).toBeGreaterThan(0);
    });
  });

  describe("Scenario: a transcript with a malformed line is skipped without aborting capture", () => {
    it("captures well-formed turns surrounding a malformed line and logs the skip", async () => {
      const lines = [
        assistantTurnLine("before"),
        "{not valid json",
        assistantTurnLine("after"),
      ];
      await writeFile(transcriptPath, lines.map((l) => l + "\n").join(""));

      const payload = JSON.stringify({ session_id: "sess-malformed", transcript_path: transcriptPath });
      const { exitCode } = await runStopHook(tmpDir, payload);
      expect(exitCode).toBe(0);

      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      const contents = entries.map((e) => e.content as string);
      expect(contents).toEqual(["before", "after"]);

      expect(await fileExists(errorLogPath(tmpDir))).toBe(true);
    });
  });
});
