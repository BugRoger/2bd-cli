---
phase: plan
epic-id: bm-f8ce
epic-slug: session-end-memory-capture-hooks-f8ce
feature-name: Session End Finalize
wave: 2
---

# Session End Finalize

**Design:** [.beastmode/artifacts/design/2026-06-28-session-end-memory-capture-hooks-f8ce.md](../design/2026-06-28-session-end-memory-capture-hooks-f8ce.md)

## User Stories

This feature covers the SessionEnd-specific slices of two shared user stories from the PRD:

- **US 2 (shared with capture-pipeline):** SessionEnd hook failures produce a log entry under `.2b/state/hook-errors.log` and exit 0 — they must never break a terminating Claude Code session.
- **US 3 (shared with capture-pipeline):** Across session restarts and `/compile` runs, the daily log records a session-end marker for each terminated session so /compile can detect session boundaries; the cursor record for the terminating session is finalized so future runs do not re-scan the same transcript bytes.

These stories are split between the two features deliberately: capture-pipeline owns per-turn append + cursor advance during a live session; session-end-finalize owns the terminal write + marker. Splitting them keeps each hook entry point reviewable in isolation; the shared library modules (built in wave 1) make the wave-2 surface thin.

## What to Build

A new `2bd hooks session-end` subcommand. The hook is invoked by Claude Code's SessionEnd event with a stdin JSON payload (`session_id`, optionally `transcript_path`, …). Pure file I/O — no LLM call.

**SessionEnd hook entry point** (`src/hooks/session-end.ts`):

1. Check `process.env.TWOBD_HOOK_DISABLED === "1"` — if set, exit 0 immediately. (Mirrors the Stop hook's recursion guard; a nested `claude -p` that terminates inside an outer session must not emit spurious markers.)
2. Read stdin to a JSON payload. On parse failure: log to hook-errors, exit 0.
3. Validate `session_id` exists as a string. On absence/wrong type: log, exit 0.
4. If `transcript_path` is present and the file exists, perform a final cursor-resume pass identical to the Stop hook — captures any post-final-Stop turns that the terminating session may have produced. (Defensive flush; on most sessions this is a no-op.)
5. Append a session-end marker line to today's daily log via the daily-log module. The marker shape is a JSONL line of the form `{ts, session_id, role: "session-end"}` — same envelope as captured turns, distinct `role` value, no `content` field. This is the boundary signal `/compile` will use.
6. Write a final cursor update for this `session_id` (updated `last_updated_iso`; offset reflects the post-flush position). Atomic write via the cursor-store module.
7. Any uncaught error: catch at the top level, log to hook-errors, exit 0.

The hook never writes to stdout/stderr in success paths. Exit code is always 0.

**CLI wiring** in `src/cli.ts`:

Register a new `session-end` subcommand under the existing `hooks` group:

```
2bd hooks session-end
```

The action is the new `sessionEndAction` from `src/hooks/session-end.ts`. Like the Stop hook, this command must NOT enforce `validateDirs` — a SessionEnd firing in a non-vault repo exits 0 silently.

**Dependency surface:**

This feature consumes — but does not modify — the shared library modules built in wave 1:

- atomic-write utility
- cursor store (load + atomic save)
- daily log (append-N-lines, with the session-end marker being one such line)
- hook-error logger
- read-transcript (for the optional final-flush pass)

Wave 1's library APIs must be stable enough that wave 2 can reuse them without modification. If wave 2 discovers a missing capability (e.g. daily-log doesn't support an arbitrary-shape line), the gap is patched in wave 1's surface and called out at implement-time, not by forking a parallel set of helpers in wave 2.

`src/cli.ts` is the only file touched by both waves; wave separation ensures no concurrent edit. The wave-2 edit is purely additive — a second `hooks.command(...)` registration.

## Integration Test Scenarios

The following Gherkin scenarios were produced by the plan-integration-tester agent for this epic. The full artifact lives at `.beastmode/artifacts/plan/2026-06-28-session-end-memory-capture-hooks-f8ce-integration.md` — these scenarios are the per-feature slice for session-end-finalize.

```gherkin
@session-end-memory-capture-hooks-f8ce @finalize
Feature: session-end finalize -- terminating cursor write and end marker

  Background:
    Given a 2bd vault with a valid .2b/ layout

  Scenario: SessionEnd writes a final cursor update for the terminating session
    Given a session has been actively captured during its lifetime
    When the SessionEnd hook fires for that session
    Then the cursor record for that session reflects the final transcript position
    And the cursor record's last-updated timestamp reflects the end of the session

  Scenario: SessionEnd emits a session-end marker into today's daily log
    Given a session has produced captured turns earlier today
    When the SessionEnd hook fires for that session
    Then today's daily log contains a session-end marker line referencing that session
    And the marker is appended after the last captured turn for that session

  Scenario: SessionEnd creates the state area lazily if no Stop hook ran first
    Given the vault has no prior state directory
    And no Stop hook has fired for the terminating session
    When the SessionEnd hook fires
    Then the state area for session captures is created
    And today's daily log contains a session-end marker for the terminating session
```

```gherkin
@session-end-memory-capture-hooks-f8ce @resilience
Feature: session-end finalize -- silent failure policy

  Scenario: SessionEnd errors are logged and never break the session
    Given the SessionEnd hook encounters an error while finalizing state
    When the hook runs
    Then the hook reports success to Claude Code
    And an error entry describing the failure is recorded in the hook error log
    And no partial or malformed file is left behind in the state area

  Scenario: SessionEnd with a malformed payload does not break the session
    Given the SessionEnd hook receives a payload that cannot be parsed
    When the hook runs
    Then the hook reports success to Claude Code
    And an error entry describing the parse failure is recorded in the hook error log
```

## Acceptance Criteria

- [ ] `2bd hooks session-end` registered in the CLI; visible in `2bd hooks --help`.
- [ ] SessionEnd hook reads stdin JSON payload, performs a defensive final-flush capture if `transcript_path` is present, appends a session-end marker line to today's daily log, and writes a final cursor update for the terminating `session_id`.
- [ ] Marker shape is JSONL with `{ts, session_id, role: "session-end"}` (no `content`) — distinct from turn entries; sufficient for `/compile` to detect session boundaries.
- [ ] Hook short-circuits to exit 0 with no I/O when `TWOBD_HOOK_DISABLED=1` is set.
- [ ] All hook errors (malformed payload, missing transcript, write failures) are caught, written to `.2b/state/hook-errors.log`, and the hook exits 0.
- [ ] State directory (`.2b/state/`) is created lazily if absent (reuses the wave-1 daily-log lazy-mkdir path).
- [ ] All cursor and daily-log writes go through the wave-1 shared modules — no parallel implementation of atomic-write, cursor I/O, or JSONL append in this feature.
- [ ] Integration test `tests/integration/session-end.integration.test.ts` drives the CLI via `Bun.spawn`, pipes a fixture stdin payload, and asserts the daily log contains a session-end marker line for the terminating session and the cursor record is updated. Follows the shape of `tests/integration/session-start.integration.test.ts` and the wave-1 stop integration test.
- [ ] All Gherkin scenarios above are exercised by the integration test.
