---
phase: implement
epic-id: bm-f8ce
epic-slug: session-end-memory-capture-hooks-f8ce
feature-id: capture-pipeline-f8ce.2
feature-name: Capture Pipeline
feature-slug: capture-pipeline-f8ce.2
status: completed
---

# Implementation Report: Capture Pipeline

**Date:** 2026-06-28
**Feature Plan:** .beastmode/artifacts/plan/2026-06-28-session-end-memory-capture-hooks-f8ce--capture-pipeline.1.md
**Tasks completed:** 11/11
**Review cycles:** 7 (spec: 4, quality: 3)
**Concerns:** 3
**BDD verification:** passed after 1 retry

## Completed Tasks

- Task 0: Integration test (haiku) — clean; revised once post-audit to tighten concurrent + cursor-independence assertions
- Task 1: `src/lib/atomic-write.ts` (haiku) — clean
- Task 2: `src/lib/hook-error-log.ts` (haiku) — clean
- Task 3: `src/lib/cursor-store.ts` (haiku) — clean
- Task 4: `src/lib/read-transcript.ts` (haiku) — with concerns (dead-code carry-over from spec)
- Task 5: `src/lib/daily-log.ts` (haiku) — with concerns (read-modify-write race, spec-accepted)
- Task 6: `src/hooks/stop.ts` (haiku) — clean
- Task 7: `src/cli.ts` (haiku) — clean
- Task 8: `src/commands/query.ts` (haiku) — clean
- Task 9: `.gitignore` (haiku) — clean
- Task 10: Final verification (haiku) — clean

## Concerns

- Task 0: Concurrent-test assertion initially over-tightened (entries.length === 2) during auditor-driven revision, which contradicts the plan's "at most one captured turn block may be lost" tolerance. Relaxed in commit 515a132 to accept 1 or 2 entries while still asserting well-formed JSON and no partial trailing line — matches the Gherkin contract exactly.
- Task 4: `src/lib/read-transcript.ts:60-61` carries a redundant ternary from the spec (`endsWithNewline ? rawLines.length - 1 : rawLines.length - 1`). Behaviour is correct (partial trailing line is left for next invocation), but the ternary could be simplified. Not a blocker — spec-verbatim.
- Task 5: `appendTurnsToDailyLog` is read-modify-write, not append-O_APPEND. Two concurrent invocations on the same date file can lose one writer's entries. The plan and integration test explicitly accept this trade-off ("at worst one block lost, never a partially written line"). The atomic-write rename still guarantees the file is never half-written.

## Blocked Tasks

None.

## BDD Verification

- Result: passed after 1 retry
- Retries: 1 (haiku: 1, sonnet: 0, opus: 0)
- Last failure: `concurrent Stop invocations on the same day never produce a malformed daily log — expected 1 to be 2` — assertion mismatch with the plan's one-block-loss tolerance, not a hook bug
- Responsible task: Task 0 (assertion fix only; no hook code changed)
- Final state: all 15 integration scenarios for `stop.integration.test.ts` green

## Test Suite Status

- Unit tests for capture-pipeline: **31/31 green** (atomic-write 5, hook-error-log 5, cursor-store 5, read-transcript 9, daily-log 7)
- Integration test `tests/integration/stop.integration.test.ts`: **15/15 green**
- Full suite: 147 passed, 9 failed. **The 9 failures are pre-existing** in `tests/unit/validate-dirs.test.ts`, `tests/unit/assemble-context.test.ts`, `tests/integration/session-start.integration.test.ts`, and `tests/integration/moc-discovery-and-assembly.integration.test.ts` — they predate this branch (introduced by commits `76cb68c "Relax vault validation to only require .2b/system/ subdirectory"` and `f5e2fec "Reduce context assembly categories to system only"`). `git diff --name-only main..HEAD` confirms none of the failing test files were modified by this feature.
- `bun run src/cli.ts hooks --help` lists both `session-start` and `stop` with the correct description.
- `.gitignore` contains `.2b/state/`.
- No `TODO`/`FIXME`/`XXX` markers in the six new capture-pipeline files.

## Acceptance Criteria Status

- [x] `2bd hooks stop` registered in the CLI; visible in `2bd hooks --help`.
- [x] Stop hook reads stdin JSON payload, captures completed turns, appends one JSONL line per turn to `.2b/state/sessions/YYYY-MM-DD.jsonl` (local date).
- [x] JSONL line shape `{ts, session_id, role, content}`; tool_use/tool_result/thinking blocks excluded.
- [x] Successive Stop invocations advance a byte-offset cursor in `.2b/state/cursors.json`; no duplicates.
- [x] Hook short-circuits to exit 0 with no I/O when `TWOBD_HOOK_DISABLED=1`.
- [x] `src/commands/query.ts` sets `TWOBD_HOOK_DISABLED=1` on the spawned `claude` child env.
- [x] Hook errors caught, written to `.2b/state/hook-errors.log`, exit 0.
- [x] Daily-log and cursor-store writes use atomic temp+rename.
- [x] State directory created lazily on first write; gitignored.
- [x] Unit tests cover cursor math, JSONL serialization, atomic-write race, recursion-guard short-circuit.
- [x] Integration test `tests/integration/stop.integration.test.ts` drives the CLI via subprocess and asserts on daily log + cursor state.
- [x] All Gherkin scenarios from the plan exercised by integration test or unit-test cousins.
