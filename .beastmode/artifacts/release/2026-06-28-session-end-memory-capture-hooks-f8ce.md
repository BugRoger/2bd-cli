---
phase: release
epic-id: bm-f8ce
epic-slug: session-end-memory-capture-hooks-f8ce
bump: minor
---

# Release: session-end-memory-capture-hooks-f8ce

**Bump:** minor
**Date:** 2026-06-28

## Highlights

Adds the write-side companion to SessionStart context injection: two new Claude Code hooks (`2bd hooks stop` and `2bd hooks session-end`) capture every assistant turn into a per-day JSONL log under `.2b/state/sessions/`, with atomic writes, byte-offset cursors for crash-safe resume, and a `TWOBD_HOOK_DISABLED` sentinel that prevents the existing `query` subprocess from polluting the parent session's daily log.

## Features

- Add `2bd hooks stop` subcommand that reads new transcript bytes per turn and appends JSONL lines to `.2b/state/sessions/YYYY-MM-DD.jsonl`
- Add `2bd hooks session-end` subcommand that finalizes the cursor and writes a session-end marker into the daily log
- Add daily-log writer with `appendSessionEndMarker` helper
- Add cursor store with atomic load/save under `.2b/state/cursors.json`
- Add transcript slice parser that emits one record per completed turn (text blocks only)
- Add `atomicWriteFile` primitive (temp + rename) used by daily log, cursor store, and error log
- Add hook-error logger writing to `.2b/state/hook-errors.log` so capture failures never break Claude Code
- Inject `TWOBD_HOOK_DISABLED=1` into the `query` subprocess env to short-circuit the Stop hook and prevent recursion
- Gitignore `.2b/state/` so the new mutable state directory is never committed

## Fixes

- (none)

## Full Changelog

- fd99a7d validate(session-end-memory-capture-hooks-f8ce): checkpoint (#15)
- 11932ef implement(session-end-memory-capture-hooks-f8ce--session-end-finalize-f8ce.1): checkpoint
- 63e6a1f feat(session-end-finalize): register hooks session-end subcommand
- 5775ded feat(session-end-finalize): add sessionEndAction hook entry point
- 85ac5e4 feat(session-end-finalize): add appendSessionEndMarker helper to daily-log
- 37f6553 test(session-end-finalize): seed failing integration test for hooks session-end
- a95f6eb implement(session-end-memory-capture-hooks-f8ce--capture-pipeline-f8ce.2): checkpoint
- 515a132 test(capture-pipeline): match concurrent assertion to spec's one-block-loss tolerance
- 11f32ab feat(capture-pipeline): inject TWOBD_HOOK_DISABLED into query subprocess
- cd0ff58 chore(capture-pipeline): gitignore .2b/state/
- 6b1d93c feat(capture-pipeline): register hooks stop subcommand
- 1f7f239 feat(capture-pipeline): add stop hook entry point
- 6d3388e feat(capture-pipeline): add transcript slice parser
- 0e25204 feat(capture-pipeline): add daily-log writer
- 59ff62d feat(capture-pipeline): add cursor store load/save
- b2b8d39 test(capture-pipeline): tighten concurrent and cursor-independence assertions
- 13c52f8 feat(capture-pipeline): add hook-error logger
- a47bf9e feat(capture-pipeline): add atomicWriteFile primitive
- 3e652a9 test(capture-pipeline): add failing integration test for stop hook
- 07a2d1c implement(session-end-memory-capture-hooks-f8ce--capture-pipeline-f8ce.2): write tasks
- dbee736 plan(session-end-memory-capture-hooks-f8ce): checkpoint
- 056eb48 design(patched-zone-f8ce): checkpoint
