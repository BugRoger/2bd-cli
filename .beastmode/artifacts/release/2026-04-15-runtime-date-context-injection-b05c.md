---
phase: release
epic-id: runtime-date-context-injection-b05c
epic-slug: runtime-date-context-injection-b05c
bump: minor
---

# Release: runtime-date-context-injection-b05c

**Version:** v0.2.0
**Date:** 2026-04-15

## Highlights

Adds runtime date context injection so the session-start hook emits a human-readable "Today's date is ..." sentence, giving Claude accurate temporal awareness without manual configuration.

## Features

- Integrate date sentence into assembled session context output
- Add date formatting module (`formatDateSentence`) with timezone-aware formatting

## Fixes

- Widen timezone regex to accept offset-style abbreviations (e.g., `GMT+2`, `UTC-5`)

## Full Changelog

- `feat(runtime-date): integrate date sentence into context assembly`
- `feat(runtime-date): add date formatting module with tests`
- `fix(runtime-date): widen timezone regex to accept offset-style abbreviations`
- `test(runtime-date): update existing integration tests for date prefix`
- `test(runtime-date): add integration tests for date context injection (RED)`
