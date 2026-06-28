# Session End Finalize — Implementation Tasks

## Goal

Implement `2bd hooks session-end`: a Claude Code SessionEnd hook that performs a final cursor-resume capture pass for the terminating session, appends a session-end marker line to today's daily log, and finalizes the cursor record. Pure file I/O, no LLM call, never breaks the session (always exit 0).

## Architecture

The hook mirrors `src/hooks/stop.ts` exactly, with two deltas:

1. After the optional final-flush capture, it appends a marker line `{ts, session_id, role: "session-end"}` (no `content`) to today's daily log via a new shared helper.
2. It runs even when the stdin payload omits `transcript_path` (the SessionEnd payload may not include one — capture is best-effort).

All writes go through wave-1 shared modules:
- `src/lib/atomic-write.ts` (tmp+rename)
- `src/lib/cursor-store.ts` (cursor JSON store, ISO timestamps)
- `src/lib/daily-log.ts` (turn appends — extended in this wave with a marker append)
- `src/lib/hook-error-log.ts` (best-effort error log)
- `src/lib/read-transcript.ts` (resume-from-offset transcript slice)

## Tech Stack

- TypeScript on Bun runtime
- Vitest (`bun run test`)
- Commander.js for CLI registration
- node:fs/promises, node:child_process for tests

## Conventions

- TDD: integration test authored RED before any production code
- Vitest, real temp dirs (`mkdtemp` + `afterEach` cleanup), no fs mocking
- Optional `now?: Date` for time-dependent functions
- Integration tests spawn `bun run src/cli.ts hooks session-end` and pipe stdin
- Hook errors caught at top level, written via `logHookError`, exit 0
- Recursion guard: `process.env.TWOBD_HOOK_DISABLED === "1"` short-circuits to exit 0 with no I/O
- State directory `.2b/state/` is created lazily by downstream writes — the hook itself does not pre-create it

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/lib/daily-log.ts` | Extend with a new exported `appendSessionEndMarker(cwd, opts)` helper that writes a single line `{ts, session_id, role: "session-end"}` (no `content`) to today's daily log via `atomicWriteFile`. Existing `appendTurnsToDailyLog` is untouched. | Modify |
| `tests/unit/daily-log.test.ts` | Add unit tests for `appendSessionEndMarker`. | Modify |
| `src/hooks/session-end.ts` | New hook entry point exporting `sessionEndAction()`. Mirrors `src/hooks/stop.ts`. | Create |
| `src/cli.ts` | Register `hooks session-end` subcommand wired to `sessionEndAction`. | Modify |
| `tests/integration/session-end.integration.test.ts` | Integration test spawning the CLI, asserting marker + cursor record + error paths per Gherkin scenarios. | Create |

## Wave Isolation

| Wave | Tasks | Files | Parallel-safe | Reason |
|------|-------|-------|---------------|--------|
| 0 | T0 | tests/integration/session-end.integration.test.ts | n/a | single task |
| 1 | T1 | src/lib/daily-log.ts, tests/unit/daily-log.test.ts | n/a | single task |
| 2 | T2 | src/hooks/session-end.ts | n/a | single task (depends on T1's new export) |
| 3 | T3 | src/cli.ts | n/a | single task (depends on T2) |
| 4 | T4 | (verification only — no file writes) | n/a | single task (depends on T3) |

No parallel waves: dependency chain is fully linear because each task either creates the symbol a downstream task imports, or depends on the prior task's production file existing.

---

## Task 0: Integration test seed (RED)

**Wave:** 0
**Depends on:** -
**Parallel-safe:** n/a (single task in wave)

**Files:**
- Create: `tests/integration/session-end.integration.test.ts`

**Goal:** Author the full integration test for `2bd hooks session-end` covering all Gherkin scenarios from the feature plan. Expected to FAIL on first run because the `session-end` subcommand is not yet registered.

- [x] **Step 1: Write the failing integration test**

Create `tests/integration/session-end.integration.test.ts` with the following exact contents:

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

async function runSessionEndHook(
  cwd: string,
  stdinPayload: string,
  extraEnv: Record<string, string> = {}
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn("bun", ["run", CLI_PATH, "hooks", "session-end"], {
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

function assistantTurnLine(text: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
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

describe("CLI integration: hooks session-end — finalize", () => {
  let tmpDir: string;
  let transcriptPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-session-end-test-"));
    await createVault(tmpDir);
    transcriptPath = join(tmpDir, "transcript.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("Scenario: SessionEnd writes a final cursor update for the terminating session", () => {
    it("finalizes the cursor with the post-flush byte offset and refreshed timestamp", async () => {
      await writeTranscript(transcriptPath, [
        assistantTurnLine("turn-1"),
        assistantTurnLine("turn-2"),
      ]);

      const payload = JSON.stringify({ session_id: "sess-final", transcript_path: transcriptPath });
      const { exitCode } = await runSessionEndHook(tmpDir, payload);
      expect(exitCode).toBe(0);

      const cursors = JSON.parse(await readFile(cursorsPath(tmpDir), "utf-8"));
      expect(cursors["sess-final"]).toBeDefined();
      expect(cursors["sess-final"].transcript_path).toBe(transcriptPath);
      expect(cursors["sess-final"].byte_offset).toBeGreaterThan(0);
      expect(typeof cursors["sess-final"].last_updated_iso).toBe("string");
      expect((cursors["sess-final"].last_updated_iso as string).length).toBeGreaterThan(0);
    });
  });

  describe("Scenario: SessionEnd emits a session-end marker into today's daily log", () => {
    it("appends a marker line {ts, session_id, role:'session-end'} with no content field", async () => {
      await writeTranscript(transcriptPath, [assistantTurnLine("only turn")]);

      const payload = JSON.stringify({ session_id: "sess-marker", transcript_path: transcriptPath });
      const { exitCode } = await runSessionEndHook(tmpDir, payload);
      expect(exitCode).toBe(0);

      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      // Last line must be the marker. Captured turn (if any) precedes it.
      const last = entries[entries.length - 1];
      expect(last.role).toBe("session-end");
      expect(last.session_id).toBe("sess-marker");
      expect(typeof last.ts).toBe("string");
      expect((last.ts as string).length).toBeGreaterThan(0);
      expect("content" in last).toBe(false);
    });

    it("appends the marker after any captured turns from the final flush", async () => {
      await writeTranscript(transcriptPath, [
        assistantTurnLine("before-end-1"),
        assistantTurnLine("before-end-2"),
      ]);

      const payload = JSON.stringify({ session_id: "sess-order", transcript_path: transcriptPath });
      const { exitCode } = await runSessionEndHook(tmpDir, payload);
      expect(exitCode).toBe(0);

      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      // Order: turn-1, turn-2, marker
      expect(entries.length).toBe(3);
      expect(entries[0]).toMatchObject({ role: "assistant", content: "before-end-1" });
      expect(entries[1]).toMatchObject({ role: "assistant", content: "before-end-2" });
      expect(entries[2]).toMatchObject({ role: "session-end", session_id: "sess-order" });
    });
  });

  describe("Scenario: SessionEnd creates the state area lazily if no Stop hook ran first", () => {
    it("lazily creates .2b/state/sessions/ and writes the marker with no prior cursor", async () => {
      await writeTranscript(transcriptPath, [assistantTurnLine("first ever")]);
      expect(await fileExists(join(tmpDir, ".2b", "state"))).toBe(false);

      const payload = JSON.stringify({ session_id: "sess-lazy", transcript_path: transcriptPath });
      const { exitCode } = await runSessionEndHook(tmpDir, payload);
      expect(exitCode).toBe(0);

      expect(await fileExists(join(tmpDir, ".2b", "state"))).toBe(true);
      expect(await fileExists(dailyLogPath(tmpDir))).toBe(true);
      expect(await fileExists(cursorsPath(tmpDir))).toBe(true);

      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      const markers = entries.filter((e) => e.role === "session-end");
      expect(markers.length).toBe(1);
      expect(markers[0].session_id).toBe("sess-lazy");
    });
  });

  describe("Scenario: SessionEnd short-circuits when the recursion guard is set", () => {
    it("does nothing and exits 0 when TWOBD_HOOK_DISABLED=1", async () => {
      await writeTranscript(transcriptPath, [assistantTurnLine("should be ignored")]);

      const payload = JSON.stringify({ session_id: "sess-guard", transcript_path: transcriptPath });
      const { exitCode } = await runSessionEndHook(tmpDir, payload, { TWOBD_HOOK_DISABLED: "1" });

      expect(exitCode).toBe(0);
      expect(await fileExists(dailyLogPath(tmpDir))).toBe(false);
      expect(await fileExists(cursorsPath(tmpDir))).toBe(false);
      expect(await fileExists(errorLogPath(tmpDir))).toBe(false);
    });
  });

  describe("Scenario: SessionEnd errors are logged and never break the session", () => {
    it("logs and exits 0 when transcript_path points to a missing file", async () => {
      const missing = join(tmpDir, "does-not-exist.jsonl");
      const payload = JSON.stringify({ session_id: "sess-missing", transcript_path: missing });
      const { exitCode } = await runSessionEndHook(tmpDir, payload);
      expect(exitCode).toBe(0);
      expect(await fileExists(errorLogPath(tmpDir))).toBe(true);

      // The marker must still be written even when the transcript read failed.
      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      const markers = entries.filter((e) => e.role === "session-end");
      expect(markers.length).toBe(1);
      expect(markers[0].session_id).toBe("sess-missing");
    });

    it("writes the marker even when transcript_path is omitted from the payload", async () => {
      const payload = JSON.stringify({ session_id: "sess-no-transcript" });
      const { exitCode } = await runSessionEndHook(tmpDir, payload);
      expect(exitCode).toBe(0);

      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      const markers = entries.filter((e) => e.role === "session-end");
      expect(markers.length).toBe(1);
      expect(markers[0].session_id).toBe("sess-no-transcript");
    });
  });

  describe("Scenario: SessionEnd with a malformed payload does not break the session", () => {
    it("exits 0 and writes a parse-error entry to hook-errors.log", async () => {
      const { exitCode } = await runSessionEndHook(tmpDir, "this is not json");
      expect(exitCode).toBe(0);
      expect(await fileExists(errorLogPath(tmpDir))).toBe(true);
      const errs = await readFile(errorLogPath(tmpDir), "utf-8");
      expect(errs.length).toBeGreaterThan(0);
      // No marker should have been written for an unidentifiable session.
      expect(await fileExists(dailyLogPath(tmpDir))).toBe(false);
    });

    it("exits 0 and logs when session_id is missing", async () => {
      const payload = JSON.stringify({ transcript_path: "/tmp/whatever.jsonl" });
      const { exitCode } = await runSessionEndHook(tmpDir, payload);
      expect(exitCode).toBe(0);
      expect(await fileExists(errorLogPath(tmpDir))).toBe(true);
      expect(await fileExists(dailyLogPath(tmpDir))).toBe(false);
    });
  });
});
```

- [x] **Step 2: Run integration test to verify it fails (RED)**

Run: `bunx vitest run tests/integration/session-end.integration.test.ts`

Expected: FAIL. Most likely failure: the spawned `bun run … hooks session-end` exits with a non-zero code because commander reports "unknown command 'session-end'". The first assertion `expect(exitCode).toBe(0)` should fail with received value `1`.

- [x] **Step 3: Commit the failing test**

```bash
git add tests/integration/session-end.integration.test.ts
git commit -m "test(session-end-finalize): seed failing integration test for hooks session-end"
```

---

## Task 1: Extend daily-log with session-end marker helper

**Wave:** 1
**Depends on:** Task 0
**Parallel-safe:** n/a (single task in wave)

**Files:**
- Modify: `src/lib/daily-log.ts` (add new exports; do not change `appendTurnsToDailyLog` signature)
- Modify: `tests/unit/daily-log.test.ts` (add unit tests for the new helper)

**Goal:** Add `appendSessionEndMarker(cwd, opts)` to `src/lib/daily-log.ts`. The helper appends a single JSONL line `{ts, session_id, role: "session-end"}` (no `content` field) to today's daily log via the existing atomic-write path. Reuses date resolution and append-or-create semantics already in the file.

- [x] **Step 1: Write the failing unit tests**

Append these tests to `tests/unit/daily-log.test.ts` inside a new `describe("appendSessionEndMarker", …)` block placed after the existing `describe("appendTurnsToDailyLog", …)` block (still inside the outer `describe("daily-log", …)`). Also import the new symbol — change the existing import line at the top of the file:

Replace this import line:
```typescript
import { appendTurnsToDailyLog, dailyLogPath } from "../../src/lib/daily-log.js";
```

With:
```typescript
import { appendTurnsToDailyLog, appendSessionEndMarker, dailyLogPath } from "../../src/lib/daily-log.js";
```

Then add the following describe block immediately before the closing `});` of the outer `describe("daily-log", …)`:

```typescript
  describe("appendSessionEndMarker", () => {
    it("appends a single line with ts, session_id, role='session-end' and no content field", async () => {
      const fixedNow = new Date(2026, 5, 28, 9, 0, 0);
      await appendSessionEndMarker(tmpDir, { session_id: "sess-end", now: fixedNow });

      const path = dailyLogPath(tmpDir, fixedNow);
      const lines = (await readFile(path, "utf-8")).split("\n").filter((l) => l.length > 0);
      expect(lines.length).toBe(1);
      const entry = JSON.parse(lines[0]);
      expect(entry).toEqual({
        ts: fixedNow.toISOString(),
        session_id: "sess-end",
        role: "session-end",
      });
      expect("content" in entry).toBe(false);
    });

    it("creates .2b/state/sessions/ lazily on first call", async () => {
      const fixedNow = new Date(2026, 5, 28, 9, 0, 0);
      await appendSessionEndMarker(tmpDir, { session_id: "sess-lazy", now: fixedNow });
      const path = dailyLogPath(tmpDir, fixedNow);
      const body = await readFile(path, "utf-8");
      expect(body).toContain("session-end");
      expect(body).toContain("sess-lazy");
    });

    it("appends to existing content without overwriting prior turn entries", async () => {
      const fixedNow = new Date(2026, 5, 28, 9, 0, 0);
      await appendTurnsToDailyLog(
        tmpDir,
        [{ role: "assistant", content: "prior turn" }],
        { session_id: "sess-x", now: fixedNow }
      );
      await appendSessionEndMarker(tmpDir, { session_id: "sess-x", now: fixedNow });

      const path = dailyLogPath(tmpDir, fixedNow);
      const lines = (await readFile(path, "utf-8")).split("\n").filter((l) => l.length > 0);
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]).content).toBe("prior turn");
      expect(JSON.parse(lines[1]).role).toBe("session-end");
    });

    it("uses the supplied now? for the ts field", async () => {
      const fixedNow = new Date(2026, 0, 3, 12, 0, 0);
      await appendSessionEndMarker(tmpDir, { session_id: "s", now: fixedNow });
      const path = dailyLogPath(tmpDir, fixedNow);
      const line = (await readFile(path, "utf-8")).split("\n").filter((l) => l.length > 0)[0];
      expect(JSON.parse(line).ts).toBe(fixedNow.toISOString());
    });
  });
```

- [x] **Step 2: Run unit tests to verify they fail**

Run: `bunx vitest run tests/unit/daily-log.test.ts`

Expected: FAIL. The import of `appendSessionEndMarker` resolves to `undefined`, so the test file throws `TypeError: appendSessionEndMarker is not a function` (or vitest reports the symbol as not exported). At minimum the four new tests in the `appendSessionEndMarker` block must fail.

- [x] **Step 3: Implement appendSessionEndMarker in src/lib/daily-log.ts**

Add to `src/lib/daily-log.ts` (append at the end of the file, after `appendTurnsToDailyLog`):

```typescript
export interface SessionEndMarkerOptions {
  session_id: string;
  now?: Date;
}

export async function appendSessionEndMarker(
  cwd: string,
  options: SessionEndMarkerOptions
): Promise<void> {
  const now = options.now ?? new Date();
  const path = dailyLogPath(cwd, now);
  const ts = now.toISOString();

  let existing = "";
  try {
    existing = await readFile(path, "utf-8");
  } catch {
    // missing file is fine
  }

  const markerLine = JSON.stringify({
    ts,
    session_id: options.session_id,
    role: "session-end",
  });

  const next = existing.length === 0 ? markerLine + "\n" : existing + markerLine + "\n";
  await atomicWriteFile(path, next);
}
```

Note: this reuses the same `readFile`, `atomicWriteFile`, and `dailyLogPath` imports already present at the top of the file — no new imports required.

- [x] **Step 4: Run unit tests to verify they pass**

Run: `bunx vitest run tests/unit/daily-log.test.ts`

Expected: PASS. All existing daily-log tests plus the four new `appendSessionEndMarker` tests are green.

- [x] **Step 5: Run the full test suite to confirm no regressions**

Run: `bun run test`

Expected: All tests pass except the session-end integration test from Task 0, which still fails (no hook yet registered).

- [x] **Step 6: Commit**

```bash
git add src/lib/daily-log.ts tests/unit/daily-log.test.ts
git commit -m "feat(session-end-finalize): add appendSessionEndMarker helper to daily-log"
```

---

## Task 2: Implement session-end hook entry point

**Wave:** 2
**Depends on:** Task 1
**Parallel-safe:** n/a (single task in wave)

**Files:**
- Create: `src/hooks/session-end.ts`

**Goal:** Create the hook action. Mirrors `src/hooks/stop.ts` with these differences:
1. `transcript_path` is OPTIONAL in the payload. If present and the file exists (or even if it doesn't — `readTranscriptSlice` will log and return zero turns), do a resume-cursor capture pass.
2. After the optional capture, always append a session-end marker via `appendSessionEndMarker`.
3. Always write a cursor record for the session — even when no transcript was provided, the record is written with `transcript_path = ""` and `byte_offset = 0` to mark the session as finalized.

There is no production code yet in this file — Task 2 creates it from scratch.

- [x] **Step 1: Verify there is no pre-existing test for this file**

Run: `ls src/hooks/session-end.ts 2>/dev/null || echo "not present"`

Expected: `not present`. The integration test from Task 0 is the driver — no separate unit test for this hook (matches the convention from `src/hooks/stop.ts`, which has no unit test either).

- [x] **Step 2: Create the hook entry point**

Create `src/hooks/session-end.ts` with exactly the following contents:

```typescript
import { logHookError } from "../lib/hook-error-log.js";
import { loadCursorStore, saveCursorStore } from "../lib/cursor-store.js";
import { readTranscriptSlice } from "../lib/read-transcript.js";
import { appendTurnsToDailyLog, appendSessionEndMarker } from "../lib/daily-log.js";

interface SessionEndPayload {
  session_id: string;
  transcript_path?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function validatePayload(raw: unknown): SessionEndPayload | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.session_id !== "string" || obj.session_id.length === 0) return null;
  const transcript_path =
    typeof obj.transcript_path === "string" && obj.transcript_path.length > 0
      ? obj.transcript_path
      : undefined;
  return { session_id: obj.session_id, transcript_path };
}

export async function sessionEndAction(): Promise<void> {
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
      await logHookError(cwd, "session-end hook stdin payload was not valid JSON", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const payload = validatePayload(parsed);
    if (payload === null) {
      await logHookError(cwd, "session-end hook payload missing required fields", {
        keys: Object.keys((parsed as Record<string, unknown>) ?? {}).join("|"),
      });
      return;
    }

    const store = await loadCursorStore(cwd);

    let finalTranscriptPath = "";
    let finalByteOffset = 0;

    if (payload.transcript_path) {
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

      finalTranscriptPath = payload.transcript_path;
      finalByteOffset = sliceResult.newByteOffset;
    } else {
      const prior = store[payload.session_id];
      if (prior) {
        finalTranscriptPath = prior.transcript_path;
        finalByteOffset = prior.byte_offset;
      }
    }

    await appendSessionEndMarker(cwd, { session_id: payload.session_id });

    store[payload.session_id] = {
      transcript_path: finalTranscriptPath,
      byte_offset: finalByteOffset,
      last_updated_iso: new Date().toISOString(),
    };
    await saveCursorStore(cwd, store);
  } catch (err) {
    await logHookError(cwd, "uncaught error in session-end hook", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

- [x] **Step 3: Type-check by running the full suite**

Run: `bun run test`

Expected: The hook file compiles. The session-end integration test from Task 0 still fails because the CLI does not yet register the subcommand — `bun run … hooks session-end` will still report "unknown command 'session-end'" and exit non-zero. All other tests (including the daily-log unit tests from Task 1) pass.

- [x] **Step 4: Commit**

```bash
git add src/hooks/session-end.ts
git commit -m "feat(session-end-finalize): add sessionEndAction hook entry point"
```

---

## Task 3: Register session-end subcommand in CLI

**Wave:** 3
**Depends on:** Task 2
**Parallel-safe:** n/a (single task in wave)

**Files:**
- Modify: `src/cli.ts`

**Goal:** Wire `2bd hooks session-end` to `sessionEndAction`. Place the registration immediately after the existing `hooks stop` registration. NO `validateDirs`.

- [x] **Step 1: Confirm the integration test still fails before the change**

Run: `bunx vitest run tests/integration/session-end.integration.test.ts`

Expected: FAIL. The spawned subcommand is still unknown to commander.

- [x] **Step 2: Add the import**

Edit `src/cli.ts`. Replace this line:

```typescript
import { stopAction } from "./hooks/stop.js";
```

With:

```typescript
import { stopAction } from "./hooks/stop.js";
import { sessionEndAction } from "./hooks/session-end.js";
```

- [x] **Step 3: Add the subcommand registration**

In `src/cli.ts`, immediately after this block:

```typescript
hooks
  .command("stop")
  .description("Capture session turns to daily JSONL log")
  .action(stopAction);
```

Insert this block:

```typescript
hooks
  .command("session-end")
  .description("Finalize a Claude Code session: flush remaining turns and append a session-end marker")
  .action(sessionEndAction);
```

- [x] **Step 4: Verify the subcommand shows up in --help**

Run: `bun run src/cli.ts hooks --help`

Expected: stdout includes both `stop` and `session-end` subcommands, with the session-end description present.

- [x] **Step 5: Run the integration test to verify it now passes (GREEN)**

Run: `bunx vitest run tests/integration/session-end.integration.test.ts`

Expected: PASS. All scenarios from Task 0 are now green.

- [x] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat(session-end-finalize): register hooks session-end subcommand"
```

---

## Task 4: Final verification

**Wave:** 4
**Depends on:** Task 3
**Parallel-safe:** n/a (single task in wave)

**Files:** none (verification only)

**Goal:** Run the full test suite and confirm both the integration test from Task 0 and the unit tests from Task 1 pass alongside all existing tests. Confirm `--help` lists the new subcommand.

- [x] **Step 1: Run the full integration test directory**

Run: `bunx vitest run tests/integration/`

Expected: PASS for all integration tests, including `session-end.integration.test.ts`.

- [x] **Step 2: Run the full test suite**

Run: `bun run test`

Expected: All tests pass (unit + integration). Zero failures, zero skips related to this feature.

- [x] **Step 3: Confirm CLI surface**

Run: `bun run src/cli.ts hooks --help`

Expected: Output lists `session-start`, `stop`, and `session-end` subcommands.

- [x] **Step 4: Confirm hook short-circuit manually (optional sanity check)**

Run: `printf '%s' '{"session_id":"manual-check"}' | TWOBD_HOOK_DISABLED=1 bun run src/cli.ts hooks session-end; echo "exit=$?"`

Expected: `exit=0` and no files written under `.2b/state/` of the working directory (do not run this in the repo root unless you intend to verify in a scratch directory — use a temp dir if in doubt).

- [x] **Step 5: Final commit (no-op if no source changes since Task 3)**

If `git status` shows no pending changes, skip the commit step. Otherwise:

```bash
git add -A
git commit -m "chore(session-end-finalize): verify full suite green"
```

---

## Acceptance Criteria Coverage

| Criterion | Task |
|-----------|------|
| `2bd hooks session-end` registered in CLI; visible in `hooks --help` | T3 (step 4), T4 (step 3) |
| Hook reads stdin JSON, performs defensive final-flush capture if `transcript_path` present, appends marker, writes cursor update | T2 (impl), T0 (asserts) |
| Marker shape `{ts, session_id, role: "session-end"}` with no `content` | T1 (unit), T0 (integration) |
| Short-circuit on `TWOBD_HOOK_DISABLED=1` | T2 (impl), T0 ("Scenario: short-circuits when the recursion guard is set") |
| All hook errors caught, written to `.2b/state/hook-errors.log`, exit 0 | T2 (top-level try/catch), T0 ("errors are logged"/"malformed payload") |
| State directory created lazily | T2 (no pre-create), T0 ("creates the state area lazily") |
| All writes via wave-1 shared modules | T2 (only imports from `src/lib/*`) |
| Integration test mirrors stop.integration.test.ts | T0 |
| All Gherkin scenarios exercised by integration test | T0 (one `describe` per scenario) |
