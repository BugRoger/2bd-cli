---
phase: implement
epic-id: bm-f8ce
epic-slug: session-end-memory-capture-hooks-f8ce
feature-slug: capture-pipeline-f8ce.2
feature-name: Capture Pipeline
---

# Capture Pipeline — Implementation Tasks

## Goal

Build the `2bd hooks stop` subcommand and the supporting library modules that capture completed Claude Code turns to `.2b/state/sessions/YYYY-MM-DD.jsonl`. The hook is invoked on the Stop event with a stdin JSON payload (`{session_id, transcript_path, ...}`), reads the new transcript slice using a per-session byte-offset cursor in `.2b/state/cursors.json`, writes new entries atomically, and always exits 0 (errors land in `.2b/state/hook-errors.log`). A recursion guard (`TWOBD_HOOK_DISABLED=1`) prevents nested `2bd query` subprocesses from polluting the parent log.

## Architecture

- Runtime: Bun, ESM, TypeScript. Imports use `.js` extensions for relative paths.
- CLI: commander-based entry in `src/cli.ts`, subcommand grouping `hooks <subcommand>`.
- Hook entry: `src/hooks/stop.ts` exporting `stopAction()`.
- Pure libs under `src/lib/`, each dependency-injectable for tests (inject `now?: Date` for time).
- Tests: vitest. Unit tests in `tests/unit/<module>.test.ts`. Integration test in `tests/integration/stop.integration.test.ts` driving the CLI via `spawn("bun", ["run", CLI_PATH, "hooks", "stop"])`.

## Tech Stack

- TypeScript / Bun runtime
- Commander 13 for CLI
- vitest for tests
- node:fs/promises for file I/O
- node:child_process spawn for integration tests

## Locked Decisions

- Module filenames (kebab-case): `src/lib/atomic-write.ts`, `src/lib/cursor-store.ts`, `src/lib/read-transcript.ts`, `src/lib/daily-log.ts`, `src/lib/hook-error-log.ts`.
- Cursor store JSON shape: `{ [sessionId: string]: { transcript_path: string; byte_offset: number; last_updated_iso: string } }`.
- Daily log line shape: `{ts: string, session_id: string, role: "user" | "assistant", content: string}`. `ts` is ISO 8601 (`new Date().toISOString()`); inject `now?: Date` for test determinism.
- Transcript parsing: JSONL lines from Claude Code transcript format. Keep only entries with `type === "user"` or `type === "assistant"`. For each, concatenate `text` blocks from `message.content`. Drop `tool_use`, `tool_result`, `thinking` blocks. If concatenated text is empty, skip that turn (covers tool-result harness envelopes).
- Atomic write: write to `<target>.tmp.<pid>.<counter>` in the same directory, then `rename`. POSIX guarantees atomic same-directory rename.
- Hook-error-log line format: `<ISO timestamp> <message> {key=value, key=value}`. Best-effort; never throws.
- Daily-log path: `.2b/state/sessions/YYYY-MM-DD.jsonl` using local time-zone calendar date.
- Recursion guard: top of `stopAction`, `if (process.env.TWOBD_HOOK_DISABLED === "1") return;` before any I/O.
- `src/cli.ts`: register `hooks.command("stop")` with action `stopAction` — no `validateDirs` precheck.
- `src/commands/query.ts`: pass `env: { ...process.env, TWOBD_HOOK_DISABLED: "1" }` to `Bun.spawn`.
- `.gitignore`: append `.2b/state/`.

## File Structure

| Path | Status | Responsibility |
|------|--------|----------------|
| `src/lib/atomic-write.ts` | create | Same-dir temp + rename primitive. Export `atomicWriteFile(target, contents)`. |
| `src/lib/cursor-store.ts` | create | Load/save `.2b/state/cursors.json`. Export `loadCursorStore(cwd)`, `saveCursorStore(cwd, store)`. |
| `src/lib/read-transcript.ts` | create | Read transcript JSONL from byte offset; parse to turns; return `{turns, newByteOffset}`. Export `readTranscriptSlice(transcriptPath, startOffset, logError)`. |
| `src/lib/daily-log.ts` | create | Resolve today's path; append N JSONL entries atomically. Export `appendTurnsToDailyLog(cwd, turns, opts?)` and `dailyLogPath(cwd, now?)`. |
| `src/lib/hook-error-log.ts` | create | Best-effort append-only writer. Export `logHookError(cwd, message, context?)`. |
| `src/hooks/stop.ts` | create | Compose libs; read stdin payload; exit 0 always. Export `stopAction()`. |
| `src/cli.ts` | modify | Register `hooks stop` subcommand. |
| `src/commands/query.ts` | modify | Add `env: { ...process.env, TWOBD_HOOK_DISABLED: "1" }` to `Bun.spawn`. |
| `.gitignore` | modify | Append `.2b/state/`. |
| `tests/unit/atomic-write.test.ts` | create | Unit tests for `atomicWriteFile`. |
| `tests/unit/cursor-store.test.ts` | create | Unit tests for cursor store. |
| `tests/unit/read-transcript.test.ts` | create | Unit tests for transcript parsing. |
| `tests/unit/daily-log.test.ts` | create | Unit tests for daily log path and append. |
| `tests/unit/hook-error-log.test.ts` | create | Unit tests for error logger. |
| `tests/integration/stop.integration.test.ts` | create | End-to-end CLI tests with fixture stdin + transcript. |

## Wave Isolation

| Wave | Tasks | Files (per task) | Parallel-safe | Reason |
|------|-------|------------------|---------------|--------|
| 0 | T0 | T0: `tests/integration/stop.integration.test.ts` | n/a | single task; integration test in RED |
| 1 | T1, T2 | T1: `src/lib/atomic-write.ts`, `tests/unit/atomic-write.test.ts` / T2: `src/lib/hook-error-log.ts`, `tests/unit/hook-error-log.test.ts` | yes | disjoint files, no shared module exports |
| 2 | T3, T4, T5 | T3: `src/lib/cursor-store.ts`, `tests/unit/cursor-store.test.ts` / T4: `src/lib/read-transcript.ts`, `tests/unit/read-transcript.test.ts` / T5: `src/lib/daily-log.ts`, `tests/unit/daily-log.test.ts` | yes | disjoint files; each imports Wave 1 outputs read-only |
| 3 | T6 | T6: `src/hooks/stop.ts` | n/a | single task; composes Wave 2 |
| 4 | T7, T8, T9 | T7: `src/cli.ts` / T8: `src/commands/query.ts` / T9: `.gitignore` | yes | three disjoint files; no shared exports |
| 5 | T10 | full repo (read-only) | n/a | final verification only |

No file appears in two parallel tasks within the same wave. Wave 1 outputs (`atomic-write`, `hook-error-log`) are consumed by Wave 2; Wave 2 outputs are consumed by Wave 3; Wave 3 output is consumed by Wave 4 task T7.

---

## Task 0: Integration test for `2bd hooks stop` (TDD-RED)

**Wave:** 0
**Parallel-safe:** n/a
**Depends on:** none
**Files:** `tests/integration/stop.integration.test.ts`

**Goal:** Write the failing integration test that drives the full `2bd hooks stop` pipeline. Maps each Gherkin scenario to an `it(...)` block. Expected to FAIL until Wave 4 lands.

### Steps

- [ ] **Step 1: Create the integration test file**

Write `tests/integration/stop.integration.test.ts` with the following content (copy verbatim):

```typescript
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
```

- [ ] **Step 2: Run the test to confirm it fails in RED**

Run: `bun run test tests/integration/stop.integration.test.ts`
Expected: FAIL — the CLI does not yet register `hooks stop`, so spawning it errors. This is the intended TDD-RED state.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/stop.integration.test.ts
git commit -m "test(capture-pipeline): add failing integration test for stop hook"
```

### Verification

- Covers acceptance criteria:
  - "Integration test `tests/integration/stop.integration.test.ts` drives the CLI via `Bun.spawn`..."
  - "All Gherkin scenarios above are exercised by the integration test or its unit-test cousins."
- Tests stay RED until Wave 4 lands.

---

## Task 1: `src/lib/atomic-write.ts` — same-dir temp + rename primitive

**Wave:** 1
**Parallel-safe:** true
**Depends on:** none
**Files:** `src/lib/atomic-write.ts`, `tests/unit/atomic-write.test.ts`

**Goal:** Provide an atomic file-write primitive used by cursor-store and daily-log. Write to `<target>.tmp.<pid>.<counter>` in the same directory, then `rename` to the target. Creates the target's parent directory if missing.

### Steps

- [ ] **Step 1: Write the failing unit test**

Write `tests/unit/atomic-write.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atomicWriteFile } from "../../src/lib/atomic-write.js";

describe("atomicWriteFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-atomic-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes the given contents to the target path", async () => {
    const target = join(tmpDir, "out.txt");
    await atomicWriteFile(target, "hello\n");
    const body = await readFile(target, "utf-8");
    expect(body).toBe("hello\n");
  });

  it("creates the parent directory if it does not exist", async () => {
    const target = join(tmpDir, "deep", "nested", "out.txt");
    await atomicWriteFile(target, "x");
    const body = await readFile(target, "utf-8");
    expect(body).toBe("x");
  });

  it("overwrites an existing file atomically", async () => {
    const target = join(tmpDir, "out.txt");
    await writeFile(target, "old");
    await atomicWriteFile(target, "new");
    expect(await readFile(target, "utf-8")).toBe("new");
  });

  it("leaves no .tmp.* files after a successful write", async () => {
    const target = join(tmpDir, "out.txt");
    await atomicWriteFile(target, "clean");
    const entries = await readdir(tmpDir);
    expect(entries.some((e) => e.includes(".tmp."))).toBe(false);
  });

  it("supports concurrent writes to the same path without throwing", async () => {
    const target = join(tmpDir, "out.txt");
    const ops = Array.from({ length: 10 }, (_, i) => atomicWriteFile(target, `value-${i}\n`));
    await Promise.all(ops);
    const body = await readFile(target, "utf-8");
    expect(body).toMatch(/^value-\d+\n$/);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `bun run test tests/unit/atomic-write.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/lib/atomic-write.ts`**

```typescript
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

let counter = 0;

export async function atomicWriteFile(target: string, contents: string): Promise<void> {
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });

  counter += 1;
  const tmpPath = `${target}.tmp.${process.pid}.${counter}`;

  await writeFile(tmpPath, contents);
  await rename(tmpPath, target);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `bun run test tests/unit/atomic-write.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/atomic-write.ts tests/unit/atomic-write.test.ts
git commit -m "feat(capture-pipeline): add atomicWriteFile primitive"
```

### Verification

- Covers AC: "Daily-log and cursor-store writes use atomic temp+rename — concurrent invocations never produce a malformed file."

---

## Task 2: `src/lib/hook-error-log.ts` — best-effort error logger

**Wave:** 1
**Parallel-safe:** true
**Depends on:** none
**Files:** `src/lib/hook-error-log.ts`, `tests/unit/hook-error-log.test.ts`

**Goal:** Append-only writer for `.2b/state/hook-errors.log` with timestamp + message + optional context. Failures are swallowed — never throws.

### Steps

- [ ] **Step 1: Write the failing unit test**

Write `tests/unit/hook-error-log.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logHookError } from "../../src/lib/hook-error-log.js";

describe("logHookError", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-errlog-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("appends a line to .2b/state/hook-errors.log with timestamp and message", async () => {
    const fixedNow = new Date("2026-06-28T12:34:56.000Z");
    await logHookError(tmpDir, "boom", undefined, { now: fixedNow });

    const body = await readFile(join(tmpDir, ".2b", "state", "hook-errors.log"), "utf-8");
    expect(body).toContain("2026-06-28T12:34:56.000Z");
    expect(body).toContain("boom");
    expect(body.endsWith("\n")).toBe(true);
  });

  it("appends context fields as key=value pairs", async () => {
    const fixedNow = new Date("2026-06-28T12:34:56.000Z");
    await logHookError(tmpDir, "missing transcript", { session_id: "abc", transcript_path: "/x/y" }, { now: fixedNow });

    const body = await readFile(join(tmpDir, ".2b", "state", "hook-errors.log"), "utf-8");
    expect(body).toContain("session_id=abc");
    expect(body).toContain("transcript_path=/x/y");
  });

  it("appends — does not overwrite — when called multiple times", async () => {
    const fixedNow = new Date("2026-06-28T12:34:56.000Z");
    await logHookError(tmpDir, "first", undefined, { now: fixedNow });
    await logHookError(tmpDir, "second", undefined, { now: fixedNow });

    const body = await readFile(join(tmpDir, ".2b", "state", "hook-errors.log"), "utf-8");
    const lines = body.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("second");
  });

  it("lazily creates .2b/state/ when missing", async () => {
    const fixedNow = new Date("2026-06-28T12:34:56.000Z");
    await logHookError(tmpDir, "create-me", undefined, { now: fixedNow });
    const s = await stat(join(tmpDir, ".2b", "state"));
    expect(s.isDirectory()).toBe(true);
  });

  it("never throws when the target directory is unwritable", async () => {
    // Point cwd at a path that cannot be created (parent is a file)
    const blocker = join(tmpDir, "blocker");
    await import("node:fs/promises").then((m) => m.writeFile(blocker, "x"));
    // logHookError must swallow any error
    await expect(logHookError(blocker, "should-not-throw")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `bun run test tests/unit/hook-error-log.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/lib/hook-error-log.ts`**

```typescript
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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `bun run test tests/unit/hook-error-log.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hook-error-log.ts tests/unit/hook-error-log.test.ts
git commit -m "feat(capture-pipeline): add hook-error logger"
```

### Verification

- Covers AC: "All hook errors ... are caught, written to `.2b/state/hook-errors.log`."

---

## Task 3: `src/lib/cursor-store.ts` — load/save cursor map

**Wave:** 2
**Parallel-safe:** true
**Depends on:** Task 1 (atomic-write), Task 2 (hook-error-log)
**Files:** `src/lib/cursor-store.ts`, `tests/unit/cursor-store.test.ts`

**Goal:** Load `.2b/state/cursors.json` (empty map if missing, empty map plus error-log entry if malformed) and write it atomically.

### Steps

- [ ] **Step 1: Write the failing unit test**

Write `tests/unit/cursor-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCursorStore, saveCursorStore, type CursorStore } from "../../src/lib/cursor-store.js";

describe("cursor-store", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-cursors-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty map when the file is missing", async () => {
    const store = await loadCursorStore(tmpDir);
    expect(store).toEqual({});
  });

  it("loads an existing well-formed cursor map", async () => {
    await mkdir(join(tmpDir, ".2b", "state"), { recursive: true });
    const initial: CursorStore = {
      "sess-1": { transcript_path: "/x/y", byte_offset: 42, last_updated_iso: "2026-06-28T00:00:00.000Z" },
    };
    await writeFile(join(tmpDir, ".2b", "state", "cursors.json"), JSON.stringify(initial));

    const store = await loadCursorStore(tmpDir);
    expect(store).toEqual(initial);
  });

  it("returns an empty map when the file is malformed", async () => {
    await mkdir(join(tmpDir, ".2b", "state"), { recursive: true });
    await writeFile(join(tmpDir, ".2b", "state", "cursors.json"), "{not json");

    const store = await loadCursorStore(tmpDir);
    expect(store).toEqual({});
  });

  it("saves the cursor map atomically and round-trips through load", async () => {
    const next: CursorStore = {
      "sess-1": { transcript_path: "/p", byte_offset: 100, last_updated_iso: "2026-06-28T01:00:00.000Z" },
      "sess-2": { transcript_path: "/q", byte_offset: 200, last_updated_iso: "2026-06-28T02:00:00.000Z" },
    };
    await saveCursorStore(tmpDir, next);

    const onDisk = JSON.parse(await readFile(join(tmpDir, ".2b", "state", "cursors.json"), "utf-8"));
    expect(onDisk).toEqual(next);

    const reloaded = await loadCursorStore(tmpDir);
    expect(reloaded).toEqual(next);
  });

  it("creates .2b/state/ on first save when missing", async () => {
    await saveCursorStore(tmpDir, { "s": { transcript_path: "/t", byte_offset: 0, last_updated_iso: "x" } });
    const onDisk = await readFile(join(tmpDir, ".2b", "state", "cursors.json"), "utf-8");
    expect(JSON.parse(onDisk)).toMatchObject({ s: { byte_offset: 0 } });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `bun run test tests/unit/cursor-store.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/lib/cursor-store.ts`**

```typescript
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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `bun run test tests/unit/cursor-store.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cursor-store.ts tests/unit/cursor-store.test.ts
git commit -m "feat(capture-pipeline): add cursor store load/save"
```

### Verification

- Covers AC: "Successive Stop invocations on the same session advance a byte-offset cursor stored in `.2b/state/cursors.json`..."

---

## Task 4: `src/lib/read-transcript.ts` — transcript slice parser

**Wave:** 2
**Parallel-safe:** true
**Depends on:** Task 2 (hook-error-log)
**Files:** `src/lib/read-transcript.ts`, `tests/unit/read-transcript.test.ts`

**Goal:** Open transcript JSONL at the given byte offset, scan to EOF, parse each line as a Claude Code transcript entry, and return `{turns, newByteOffset}`. Drop `tool_use`, `tool_result`, `thinking` blocks; keep only `user`/`assistant` entries with non-empty concatenated text.

### Steps

- [ ] **Step 1: Write the failing unit test**

Write `tests/unit/read-transcript.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `bun run test tests/unit/read-transcript.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/lib/read-transcript.ts`**

```typescript
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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `bun run test tests/unit/read-transcript.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/read-transcript.ts tests/unit/read-transcript.test.ts
git commit -m "feat(capture-pipeline): add transcript slice parser"
```

### Verification

- Covers AC: "JSONL line shape ... `tool_use`, `tool_result`, and `thinking` blocks are excluded from `content`."
- Covers AC: "malformed JSONL line ... cursor math (empty / mid-file / past-end / malformed-line-skip)" via unit tests.

---

## Task 5: `src/lib/daily-log.ts` — atomic append-N-turns to today's file

**Wave:** 2
**Parallel-safe:** true
**Depends on:** Task 1 (atomic-write)
**Files:** `src/lib/daily-log.ts`, `tests/unit/daily-log.test.ts`

**Goal:** Resolve `.2b/state/sessions/YYYY-MM-DD.jsonl` from a local-tz date, atomically append N JSONL turn entries. Each line: `{ts, session_id, role, content}`.

### Steps

- [ ] **Step 1: Write the failing unit test**

Write `tests/unit/daily-log.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendTurnsToDailyLog, dailyLogPath } from "../../src/lib/daily-log.js";

describe("daily-log", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-dailylog-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("dailyLogPath", () => {
    it("resolves to .2b/state/sessions/YYYY-MM-DD.jsonl using the local calendar date", () => {
      const fixedNow = new Date(2026, 5, 28, 23, 59, 0); // local: 2026-06-28
      const path = dailyLogPath(tmpDir, fixedNow);
      expect(path).toBe(join(tmpDir, ".2b", "state", "sessions", "2026-06-28.jsonl"));
    });

    it("pads single-digit month and day with leading zeros", () => {
      const fixedNow = new Date(2026, 0, 3, 12, 0, 0); // local: 2026-01-03
      expect(dailyLogPath(tmpDir, fixedNow)).toContain("2026-01-03.jsonl");
    });
  });

  describe("appendTurnsToDailyLog", () => {
    it("appends one JSONL line per turn with ts, session_id, role, content", async () => {
      const fixedNow = new Date(2026, 5, 28, 9, 0, 0);
      await appendTurnsToDailyLog(
        tmpDir,
        [
          { role: "user", content: "q" },
          { role: "assistant", content: "a" },
        ],
        { session_id: "sess-1", now: fixedNow }
      );

      const path = dailyLogPath(tmpDir, fixedNow);
      const lines = (await readFile(path, "utf-8")).split("\n").filter((l) => l.length > 0);
      expect(lines.length).toBe(2);
      const e0 = JSON.parse(lines[0]);
      const e1 = JSON.parse(lines[1]);
      expect(e0).toMatchObject({ session_id: "sess-1", role: "user", content: "q" });
      expect(e1).toMatchObject({ session_id: "sess-1", role: "assistant", content: "a" });
      expect(typeof e0.ts).toBe("string");
      expect(e0.ts).toBe(fixedNow.toISOString());
    });

    it("creates .2b/state/sessions/ lazily on first append", async () => {
      const fixedNow = new Date(2026, 5, 28, 9, 0, 0);
      await appendTurnsToDailyLog(
        tmpDir,
        [{ role: "assistant", content: "first" }],
        { session_id: "s", now: fixedNow }
      );
      const path = dailyLogPath(tmpDir, fixedNow);
      const body = await readFile(path, "utf-8");
      expect(body).toContain("first");
    });

    it("appends to existing content without overwriting", async () => {
      const fixedNow = new Date(2026, 5, 28, 9, 0, 0);
      const path = dailyLogPath(tmpDir, fixedNow);
      await mkdir(join(tmpDir, ".2b", "state", "sessions"), { recursive: true });
      const existing = JSON.stringify({ ts: "old", session_id: "s0", role: "assistant", content: "old" }) + "\n";
      await writeFile(path, existing);

      await appendTurnsToDailyLog(
        tmpDir,
        [{ role: "assistant", content: "new" }],
        { session_id: "s", now: fixedNow }
      );

      const lines = (await readFile(path, "utf-8")).split("\n").filter((l) => l.length > 0);
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]).content).toBe("old");
      expect(JSON.parse(lines[1]).content).toBe("new");
    });

    it("is a no-op when given an empty turns array", async () => {
      const fixedNow = new Date(2026, 5, 28, 9, 0, 0);
      await appendTurnsToDailyLog(tmpDir, [], { session_id: "s", now: fixedNow });
      const path = dailyLogPath(tmpDir, fixedNow);
      // file should not exist
      let exists = true;
      try {
        await readFile(path);
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    });

    it("preserves multi-line content via JSON escaping", async () => {
      const fixedNow = new Date(2026, 5, 28, 9, 0, 0);
      await appendTurnsToDailyLog(
        tmpDir,
        [{ role: "assistant", content: "line1\nline2\nline3" }],
        { session_id: "s", now: fixedNow }
      );
      const path = dailyLogPath(tmpDir, fixedNow);
      const lines = (await readFile(path, "utf-8")).split("\n").filter((l) => l.length > 0);
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]).content).toBe("line1\nline2\nline3");
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `bun run test tests/unit/daily-log.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/lib/daily-log.ts`**

```typescript
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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `bun run test tests/unit/daily-log.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/daily-log.ts tests/unit/daily-log.test.ts
git commit -m "feat(capture-pipeline): add daily-log writer"
```

### Verification

- Covers AC: "captures completed turns ... appends one JSONL line per turn to `.2b/state/sessions/YYYY-MM-DD.jsonl`."
- Covers AC: "JSONL line shape is `{ts, session_id, role, content}`."
- Covers AC: "State directory (`.2b/state/`) is created lazily on first write."

---

## Task 6: `src/hooks/stop.ts` — Stop hook entry point

**Wave:** 3
**Parallel-safe:** n/a
**Depends on:** Task 3 (cursor-store), Task 4 (read-transcript), Task 5 (daily-log), Task 2 (hook-error-log)
**Files:** `src/hooks/stop.ts`

**Goal:** Compose the foundation libs into the Stop-hook flow. Recursion guard first; then stdin read, payload validate, cursor lookup, transcript slice, daily-log append, cursor save. Always exit 0.

### Steps

- [ ] **Step 1: Read stdin helper and entry point — verify integration test still RED**

Run: `bun run test tests/integration/stop.integration.test.ts`
Expected: still FAIL — the CLI hasn't been wired yet. We're about to implement the action.

- [ ] **Step 2: Implement `src/hooks/stop.ts`**

```typescript
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
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/stop.ts
git commit -m "feat(capture-pipeline): add stop hook entry point"
```

### Verification

- Covers AC: "Stop hook reads stdin JSON payload, captures completed turns ... appends one JSONL line per turn."
- Covers AC: "Successive Stop invocations on the same session advance a byte-offset cursor ... never duplicate prior turns."
- Covers AC: "Hook short-circuits to exit 0 with no I/O when `TWOBD_HOOK_DISABLED=1` is set."
- Covers AC: "All hook errors ... are caught, written to `.2b/state/hook-errors.log`."

---

## Task 7: `src/cli.ts` — register `hooks stop` subcommand

**Wave:** 4
**Parallel-safe:** true
**Depends on:** Task 6 (stop.ts)
**Files:** `src/cli.ts`

**Goal:** Wire `stopAction` into the commander CLI under the existing `hooks` group. No `validateDirs` precheck — a Stop hook in a non-vault repo must still exit 0 silently.

### Steps

- [ ] **Step 1: Edit `src/cli.ts` to add the import and the subcommand registration**

Read the current `src/cli.ts`. Replace its full contents with:

```typescript
#!/usr/bin/env bun
import { Command } from "commander";
import { sessionStartAction } from "./hooks/session-start.js";
import { stopAction } from "./hooks/stop.js";
import { queryAction } from "./commands/query.js";

const program = new Command();

program
  .name("2bd")
  .description("Developer tooling CLI for structured context management");

const hooks = program
  .command("hooks")
  .description("Claude Code hook integrations");

hooks
  .command("session-start")
  .description("Assemble .2b/ context and output hook-compatible JSON")
  .action(sessionStartAction);

hooks
  .command("stop")
  .description("Capture session turns to daily JSONL log")
  .action(stopAction);

program
  .command("query")
  .description("Query the vault using MOC-guided retrieval and get a cited summary")
  .argument("<question>", "Natural-language question to ask about the vault")
  .option("--file-back <path>", "Write result as a vault note to the specified path instead of stdout")
  .action(queryAction);

program.parse();
```

- [ ] **Step 2: Verify `hooks stop` is registered**

Run: `bun run src/cli.ts hooks --help`
Expected: output lists both `session-start` and `stop` subcommands. The stop description reads "Capture session turns to daily JSONL log".

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat(capture-pipeline): register hooks stop subcommand"
```

### Verification

- Covers AC: "`2bd hooks stop` registered in the CLI; visible in `2bd hooks --help`."

---

## Task 8: `src/commands/query.ts` — recursion-guard env injection

**Wave:** 4
**Parallel-safe:** true
**Depends on:** none (independent of other Wave 4 tasks)
**Files:** `src/commands/query.ts`

**Goal:** Pass `TWOBD_HOOK_DISABLED=1` to the spawned `claude` child so the Stop hook in the nested session short-circuits.

### Steps

- [ ] **Step 1: Edit `src/commands/query.ts` — only the `Bun.spawn` call**

Locate the `Bun.spawn(["claude", ...args], { ... })` block in `src/commands/query.ts` (around line 157). Replace exactly the existing options object so the call becomes:

```typescript
  const proc = Bun.spawn(["claude", ...args], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TWOBD_HOOK_DISABLED: "1" },
  });
```

No other changes to the file. Do not touch imports, helper functions, or the prompt builders.

- [ ] **Step 2: Run the existing query unit/integration tests to confirm nothing regressed**

Run: `bun run test tests/unit/query.test.ts tests/integration/query.integration.test.ts`
Expected: PASS — existing assertions don't bind on env, so they remain green.

- [ ] **Step 3: Commit**

```bash
git add src/commands/query.ts
git commit -m "feat(capture-pipeline): inject TWOBD_HOOK_DISABLED into query subprocess"
```

### Verification

- Covers AC: "`src/commands/query.ts` sets `TWOBD_HOOK_DISABLED=1` on the `Bun.spawn` child env."

---

## Task 9: `.gitignore` — append `.2b/state/`

**Wave:** 4
**Parallel-safe:** true
**Depends on:** none
**Files:** `.gitignore`

**Goal:** Ensure daily logs, cursor store, and error log never get committed.

### Steps

- [ ] **Step 1: Append `.2b/state/` if not already present**

Read `.gitignore`. If the literal line `.2b/state/` is absent, append it. Final state should include (existing lines preserved, plus the new entry):

```
.claude/settings.local.json
.claude/worktrees/
.beastmode/.beastmode-watch.lock
2bd-cli.code-workspace
node_modules/
dist/
bin/
cli/
.2b/state/
```

- [ ] **Step 2: Verify**

Run: `grep -F '.2b/state/' .gitignore`
Expected: output contains the line `.2b/state/`.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore(capture-pipeline): gitignore .2b/state/"
```

### Verification

- Covers AC: "State directory (`.2b/state/`) is created lazily on first write; gitignored."

---

## Task 10: Final verification — full suite green, integration RED→GREEN

**Wave:** 5
**Parallel-safe:** n/a
**Depends on:** Task 0, Task 1, Task 2, Task 3, Task 4, Task 5, Task 6, Task 7, Task 8, Task 9
**Files:** (read-only verification — no writes)

**Goal:** Confirm the full vitest suite passes (integration test now GREEN), `2bd hooks --help` lists `stop`, and no orphan TODO markers remain in capture-pipeline source.

### Steps

- [ ] **Step 1: Run the full test suite**

Run: `bun run test`
Expected: PASS — every unit test and every integration test (including `stop.integration.test.ts`) green.

- [ ] **Step 2: Verify CLI help wiring**

Run: `bun run src/cli.ts hooks --help`
Expected: output lists `stop` with description "Capture session turns to daily JSONL log".

- [ ] **Step 3: Scan capture-pipeline source for placeholder markers**

Run: `grep -RnE "TODO|FIXME|XXX" src/hooks/stop.ts src/lib/atomic-write.ts src/lib/cursor-store.ts src/lib/read-transcript.ts src/lib/daily-log.ts src/lib/hook-error-log.ts || echo "OK"`
Expected: prints `OK` (no placeholder markers in the new modules).

- [ ] **Step 4: Confirm `.gitignore` covers state**

Run: `grep -F '.2b/state/' .gitignore`
Expected: matches the appended entry.

### Verification

- This task only asserts; no production code changes. It locks the entire feature's GREEN state.
- Confirms acceptance criteria:
  - "`2bd hooks stop` registered in the CLI; visible in `2bd hooks --help`."
  - "Integration test `tests/integration/stop.integration.test.ts` drives the CLI via `Bun.spawn` ... and asserts on the resulting daily log + cursor state."
  - "All Gherkin scenarios above are exercised by the integration test or its unit-test cousins."
