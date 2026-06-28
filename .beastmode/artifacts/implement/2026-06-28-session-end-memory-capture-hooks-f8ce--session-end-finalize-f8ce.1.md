---
phase: implement
epic-id: bm-f8ce
epic-slug: session-end-memory-capture-hooks-f8ce
feature-id: session-end-finalize-f8ce.1
feature-name: Session End Finalize
feature-slug: session-end-finalize-f8ce.1
status: completed
---

# Implementation Report: Session End Finalize

**Date:** 2026-06-28
**Feature Plan:** .beastmode/artifacts/plan/2026-06-28-session-end-memory-capture-hooks-f8ce--session-end-finalize.2.md
**Tasks completed:** 5/5
**Review cycles:** 6 (spec: 3, quality: 3)
**Concerns:** 0
**BDD verification:** passed

## Completed Tasks

- Task 0: Integration test seed (haiku) — clean; 9 scenarios authored RED, all green after T3
- Task 1: `src/lib/daily-log.ts` + `tests/unit/daily-log.test.ts` (haiku) — clean; new `appendSessionEndMarker` export with 4 unit tests, existing `appendTurnsToDailyLog` unchanged
- Task 2: `src/hooks/session-end.ts` (haiku) — clean; mirrors `stop.ts` with optional `transcript_path` and unconditional marker write
- Task 3: `src/cli.ts` (haiku) — clean; `2bd hooks session-end` registered after `hooks stop`
- Task 4: Final verification (controller) — clean; suite matches baseline

## Concerns

None.

## Blocked Tasks

None.

## BDD Verification

- Result: passed (first run after T3 landed)
- Retries: 0 (haiku: 0, sonnet: 0, opus: 0)
- All 9 integration scenarios green in `tests/integration/session-end.integration.test.ts`:
  - finalize cursor with post-flush byte offset + refreshed timestamp
  - marker line shape `{ts, session_id, role: "session-end"}` with no `content`
  - marker appended after captured turns (ordering)
  - lazy state-area creation when no prior Stop hook ran
  - recursion guard (`TWOBD_HOOK_DISABLED=1`) — no I/O, no marker
  - missing-transcript error path — logged, marker still written
  - omitted `transcript_path` — marker written, cursor finalized
  - malformed JSON payload — logged, no daily log written
  - missing `session_id` — logged, no daily log written

## Test Suite Status

- New session-end unit tests (`appendSessionEndMarker`): **4/4 green**
- New session-end integration tests: **9/9 green**
- Full suite: 160 passed, 9 failed. **All 9 failures are pre-existing** in `tests/unit/validate-dirs.test.ts` (4), `tests/unit/assemble-context.test.ts` (2), `tests/integration/session-start.integration.test.ts` (2), and `tests/integration/moc-discovery-and-assembly.integration.test.ts` (1). These predate this branch (introduced by `76cb68c` and `f5e2fec` on main) and were carried over from the capture-pipeline wave; `git diff --name-only main..HEAD` confirms none of the failing test files were modified by this feature.
- `bun run src/cli.ts hooks --help` lists `session-start`, `stop`, and `session-end` with correct descriptions.

## Acceptance Criteria Status

- [x] `2bd hooks session-end` registered in the CLI; visible in `2bd hooks --help`.
- [x] SessionEnd hook reads stdin JSON payload, performs a defensive final-flush capture if `transcript_path` is present, appends a session-end marker line to today's daily log, and writes a final cursor update for the terminating `session_id`.
- [x] Marker shape is JSONL with `{ts, session_id, role: "session-end"}` (no `content`) — distinct from turn entries; sufficient for `/compile` to detect session boundaries.
- [x] Hook short-circuits to exit 0 with no I/O when `TWOBD_HOOK_DISABLED=1` is set.
- [x] All hook errors (malformed payload, missing transcript, write failures) are caught, written to `.2b/state/hook-errors.log`, and the hook exits 0.
- [x] State directory (`.2b/state/`) is created lazily if absent (reuses wave-1 daily-log lazy-mkdir via `atomicWriteFile`).
- [x] All cursor and daily-log writes go through the wave-1 shared modules — `src/hooks/session-end.ts` imports only from `src/lib/*`; no parallel implementation of atomic-write, cursor I/O, or JSONL append.
- [x] Integration test `tests/integration/session-end.integration.test.ts` drives the CLI via `Bun.spawn`, pipes fixture stdin, and asserts marker line + cursor record. Mirrors the shape of `tests/integration/stop.integration.test.ts`.
- [x] All Gherkin scenarios exercised by the integration test (one `describe` per scenario plus extra coverage for the omitted-transcript path).

## Notes for Validate

- Wave-1 (`capture-pipeline-f8ce.2`) and wave-2 (`session-end-finalize-f8ce.1`) now share `src/lib/daily-log.ts`. The added `appendSessionEndMarker` does not change `appendTurnsToDailyLog` — the Stop hook is unaffected.
- The same read-modify-write trade-off documented in the capture-pipeline audit applies to marker writes: concurrent invocations on the same date file may lose at most one write, but the atomic rename guarantees the file is never half-written. Not a concern for the marker path in practice — SessionEnd fires once per terminating session.
- Minor reviewer notes (optional refactors flagged but not blocking):
  - `readStdin` and `validatePayload` helpers are duplicated between `stop.ts` and `session-end.ts`. A shared `src/hooks/_shared.ts` would consolidate them but the plan explicitly accepted the duplication.
  - The append-body in `appendSessionEndMarker` duplicates the read-modify-write loop from `appendTurnsToDailyLog`. A shared private `appendLinesToDailyLog` would centralize the I/O path.
