---
phase: plan
epic-id: bm-f8ce
epic-slug: session-end-memory-capture-hooks-f8ce
feature-name: Capture Pipeline
wave: 1
---

# Capture Pipeline

**Design:** [.beastmode/artifacts/design/2026-06-28-session-end-memory-capture-hooks-f8ce.md](../design/2026-06-28-session-end-memory-capture-hooks-f8ce.md)

## User Stories

1. As a 2bd user, I want every assistant turn captured to a per-day JSONL file under `.2b/state/sessions/YYYY-MM-DD.jsonl`, so that a separate compile step has raw material to distill durable lessons from.
2. As a 2bd user, I want capture to be silent and never break my Claude Code session — hook failures (transcript missing, disk full, parse error) produce a log entry under `.2b/state/hook-errors.log` and exit 0 instead of stopping Claude.
3. As a 2bd user, I want capture to resume across session restarts and skip already-captured turns, so closing/reopening Claude Code (or running `/compact`) does not produce duplicated entries.
4. As a 2bd user running `2bd query` from inside a session, I want the query subprocess's internal reasoning excluded from my daily log.
5. As a 2bd user with two concurrent Claude Code sessions in different worktrees on the same day, I want concurrent Stop-hook invocations to use atomic writes so at worst one block is lost rather than producing a malformed file.

(US 2 and US 3 are also exercised by the session-end-finalize feature; the marker line that /compile relies on for boundary detection lives there.)

## What to Build

A new `2bd hooks stop` subcommand plus the shared library modules underneath it. The hook is invoked by Claude Code's Stop event with a stdin JSON payload (`session_id`, `transcript_path`, …). The pipeline does pure file I/O — no LLM call, ~50ms target.

**Shared library modules** (mirror the existing `src/lib/` shape — pure functions, dependency-injectable for tests):

- **Atomic write utility** — write-to-temp + rename primitive used by every file under `.2b/state/`. Same-directory temp so rename stays atomic on POSIX.
- **Cursor store** — load/mutate/save the `.2b/state/cursors.json` map keyed by `session_id`, each value `{transcript_path, byte_offset, last_updated_iso}`. Loaded fresh on each invocation; written atomically. Missing file returns an empty map. Malformed file is replaced (logged), not aborted.
- **Read-transcript** — open the transcript JSONL at the cursor's byte offset, scan to EOF, parse each line, and return a stream of completed turns. Drops `tool_use`, `tool_result`, and `thinking` blocks; emits only the concatenated `text` portion of `user` and `assistant` messages. Returns the new byte offset alongside the parsed turns. Malformed JSONL lines are skipped with an error-log entry, never aborting the scan.
- **Daily log** — append-N-turns operation. Resolves the target path from the local calendar date (`.2b/state/sessions/YYYY-MM-DD.jsonl`). Creates the state directory lazily (`mkdir -p`). Read-modify-write atomically via the shared write utility: read existing file (if any), append the new JSONL lines, write to temp, rename. Each line: `{ts, session_id, role, content}`.
- **Hook-error logger** — append-only writer for `.2b/state/hook-errors.log`. Plain-text lines with timestamp + message + context fields. Best-effort: failures here are swallowed (we already failed once; nothing more to do).

**Stop hook entry point** (`src/hooks/stop.ts`):

1. Check `process.env.TWOBD_HOOK_DISABLED === "1"` — if set, exit 0 immediately. No file I/O.
2. Read stdin to a JSON payload. On parse failure: log to hook-errors, exit 0.
3. Validate `transcript_path` and `session_id` exist as strings. On absence/wrong type: log, exit 0.
4. Load cursor store. Look up the cursor for this `session_id` — default to offset 0 for a new session.
5. Read the new transcript slice. Collect the resulting turns and new byte offset.
6. If any turns produced: append them to today's daily log via the daily-log module.
7. Update the cursor record (`transcript_path`, `byte_offset`, `last_updated_iso`) and write the cursor store atomically.
8. Any uncaught error: catch at the top level, log to hook-errors, exit 0.

The hook never writes to stdout or stderr in success paths — Claude Code's Stop hook does not consume hook output. Exit code is always 0.

**Recursion guard wiring** in `src/commands/query.ts`:

The existing `Bun.spawn(["claude", ...])` call must pass an `env` object that injects `TWOBD_HOOK_DISABLED=1` into the child environment (merging with `process.env` so PATH and other inheritance survives). Without this, the inner `claude -p` session's per-turn Stop hooks pollute the outer session's daily log.

**CLI wiring** in `src/cli.ts`:

Register a new `stop` subcommand under the existing `hooks` group:

```
2bd hooks stop
```

The action is the new `stopAction` from `src/hooks/stop.ts`. The command must NOT enforce the existing `validateDirs` precheck — a Stop hook firing in a non-vault repo must still exit 0 silently (no `.2b/state/` means no work to do, not an error).

**State directory bootstrap:**

The state directory is created lazily by whichever lib writes first (daily-log or cursor-store). No init command; no eager mkdir at hook entry.

**.gitignore:**

Append `.2b/state/` so the daily logs, cursor store, and error log never get committed.

## Integration Test Scenarios

The following Gherkin scenarios were produced by the plan-integration-tester agent for this epic. The full artifact lives at `.beastmode/artifacts/plan/2026-06-28-session-end-memory-capture-hooks-f8ce-integration.md` — these scenarios are the per-feature slice for capture-pipeline.

```gherkin
@session-end-memory-capture-hooks-f8ce @capture
Feature: capture pipeline -- per-turn assistant capture to daily JSONL log

  Background:
    Given a 2bd vault with a valid .2b/ layout
    And no prior capture state exists for today

  Scenario: a completed assistant turn is appended to today's daily log
    Given a Claude Code session has produced one user turn and one assistant turn
    When the Stop hook fires for that session
    Then today's daily log contains one entry for the user turn and one entry for the assistant turn
    And each entry records the timestamp, the session identifier, the role, and the textual content
    And the daily log file is named for today's local calendar date

  Scenario: only text content is captured; tool and reasoning blocks are dropped
    Given a Claude Code session produces an assistant turn that mixes text, tool use, tool result, and internal reasoning blocks
    When the Stop hook fires
    Then the daily log entry for that turn contains the text portion only
    And the entry does not contain tool invocation details, tool output, or internal reasoning

  Scenario: the daily log path uses the local calendar date
    Given the local calendar date is known
    When the Stop hook captures an assistant turn
    Then the daily log file path reflects today's local date in YYYY-MM-DD form
    And the file lives under the vault's hidden state area for session captures

  Scenario: the state area is created on first capture when absent
    Given the vault has no prior state directory
    When the Stop hook fires for the first time
    Then the state area for session captures is created
    And the daily log for today exists with the captured turn appended

  Scenario Outline: successive Stop invocations append only newly produced turns
    Given a session has produced <first_batch> assistant turns and the Stop hook has captured them
    When the session produces <second_batch> additional assistant turns
    And the Stop hook fires again
    Then today's daily log contains exactly <total> assistant entries for that session
    And no captured turn is duplicated

    Examples:
      | first_batch | second_batch | total |
      | 1           | 1            | 2     |
      | 3           | 2            | 5     |
      | 5           | 0            | 5     |
```

```gherkin
@session-end-memory-capture-hooks-f8ce @isolation
Feature: capture pipeline -- recursion guard and concurrency

  Scenario: Stop hook short-circuits when the recursion guard sentinel is set
    Given the recursion guard environment sentinel is set on the hook process
    When the Stop hook fires
    Then no entry is appended to today's daily log
    And no cursor record is created or updated
    And the hook reports success

  Scenario: a nested 2bd query subprocess does not pollute the parent session's daily log
    Given a Claude Code session is active with capture enabled
    When the user runs a 2bd query command from inside that session
    And the query subprocess's own assistant turns complete
    Then those subprocess turns do not appear in today's daily log
    And only the parent session's turns are captured

  Scenario: concurrent Stop invocations on the same day never produce a malformed daily log
    Given two Claude Code sessions in separate worktrees of the same vault both produce assistant turns
    When both sessions' Stop hooks fire concurrently
    Then today's daily log remains valid line-delimited JSON
    And every line in the file is a well-formed turn entry
    And at most one captured turn block may be lost, never a partially written line
```

```gherkin
@session-end-memory-capture-hooks-f8ce @capture
Feature: capture pipeline -- cursor resume across session lifecycle

  Scenario: reopening a session resumes capture from the prior cursor position
    Given a session produced two assistant turns and the Stop hook captured both
    And the session was then closed
    When the same session is reopened and produces one new assistant turn
    And the Stop hook fires
    Then today's daily log contains the two original turns and the one new turn
    And neither of the original turns is duplicated

  Scenario: an in-session compaction does not duplicate already-captured turns
    Given a session produced several assistant turns and the Stop hook captured them
    When the user triggers an in-session compaction
    And subsequent Stop invocations occur
    Then today's daily log contains each original turn exactly once
    And only genuinely new turns produced after compaction are appended

  Scenario: each tracked session has an independent cursor
    Given two distinct sessions have each produced assistant turns
    And the Stop hook has captured turns from both
    When either session produces a further turn
    And its Stop hook fires
    Then only that session's cursor advances
    And the other session's cursor is unchanged
```

```gherkin
@session-end-memory-capture-hooks-f8ce @resilience
Feature: capture pipeline -- silent failure policy

  Scenario: a missing transcript path is logged and does not break the session
    Given the Stop hook receives a payload whose transcript path does not exist on disk
    When the Stop hook runs
    Then the hook reports success to Claude Code
    And an error entry describing the missing transcript is recorded in the hook error log
    And today's daily log is not modified

  Scenario: a malformed payload is logged and does not break the session
    Given the Stop hook receives a payload that cannot be parsed
    When the Stop hook runs
    Then the hook reports success to Claude Code
    And an error entry describing the parse failure is recorded in the hook error log

  Scenario: a transcript with a malformed line is skipped without aborting capture
    Given the transcript contains a well-formed assistant turn followed by a malformed line followed by another well-formed assistant turn
    When the Stop hook fires
    Then the two well-formed turns are appended to today's daily log
    And the malformed line is skipped
    And an error entry referencing the skipped line is recorded in the hook error log
    And the hook reports success
```

## Acceptance Criteria

- [ ] `2bd hooks stop` registered in the CLI; visible in `2bd hooks --help`.
- [ ] Stop hook reads stdin JSON payload, captures completed turns from the transcript slice, and appends one JSONL line per turn to `.2b/state/sessions/YYYY-MM-DD.jsonl` (local date).
- [ ] JSONL line shape is `{ts, session_id, role, content}`; `tool_use`, `tool_result`, and `thinking` blocks are excluded from `content`.
- [ ] Successive Stop invocations on the same session advance a byte-offset cursor stored in `.2b/state/cursors.json` and never duplicate prior turns.
- [ ] Hook short-circuits to exit 0 with no I/O when `TWOBD_HOOK_DISABLED=1` is set in the environment.
- [ ] `src/commands/query.ts` sets `TWOBD_HOOK_DISABLED=1` on the `Bun.spawn` child env so nested `claude -p` turns do not pollute the parent daily log.
- [ ] All hook errors (missing transcript, malformed payload, malformed JSONL line) are caught, written to `.2b/state/hook-errors.log`, and the hook exits 0.
- [ ] Daily-log and cursor-store writes use atomic temp+rename — concurrent invocations never produce a malformed file (worst case: one block lost).
- [ ] State directory (`.2b/state/`) is created lazily on first write; gitignored.
- [ ] Unit tests cover: cursor math (empty / mid-file / past-end / malformed-line-skip), JSONL serialization (drop non-text blocks, escape multi-line content), atomic-write race, recursion-guard short-circuit.
- [ ] Integration test `tests/integration/stop.integration.test.ts` drives the CLI via `Bun.spawn`, pipes fixture stdin payloads against a fixture transcript, and asserts on the resulting daily log + cursor state. Follows the shape of `tests/integration/session-start.integration.test.ts`.
- [ ] All Gherkin scenarios above are exercised by the integration test or its unit-test cousins.
