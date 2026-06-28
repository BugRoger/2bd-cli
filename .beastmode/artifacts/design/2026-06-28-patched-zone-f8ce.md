---
phase: design
epic-id: bm-f8ce
epic-slug: patched-zone-f8ce
epic-name: Session End Memory Capture Hooks
---

## Problem Statement

Claude Code sessions inside a 2bd vault produce learnings worth keeping — decisions made, gotchas hit, user preferences expressed, patterns that worked or didn't — but those learnings live only inside the session's in-memory context. When the session ends (or compacts, or crashes), the in-context awareness is gone. The next session starts cold and the human rediscovers the same things. The vault already has a "Capture → memory" pattern (`CLAUDE.md` lines 372-378), but no plumbing connects a Claude Code session to it.

2bd-cli today injects vault content *into* sessions via the SessionStart hook. The symmetric write-side does not exist.

## Solution

Two new Claude Code hooks ship in 2bd-cli, both implemented as thin commander subcommands under `2bd hooks`:

- **`2bd hooks stop`** — fires on every assistant turn completion. Reads the new transcript slice since a stored byte-offset cursor, appends one JSONL line per turn to today's daily log under `.2b/state/sessions/YYYY-MM-DD.jsonl`. No LLM call. ~50ms target.
- **`2bd hooks session-end`** — fires on session termination. Finalizes the cursor state. No LLM call.

Distillation of the raw daily log into a durable `.2b/system/MEMORY.md` is performed by a separate `/compile` skill that lives in the vault (outside this PRD's scope). MEMORY.md is automatically picked up by the existing `assembleContext` because it sits in `.2b/system/` and that directory is already concatenated into the SessionStart additional-context payload. The read-back side requires no code changes in 2bd-cli.

A namespaced env-var sentinel (`TWOBD_HOOK_DISABLED=1`) prevents subprocess recursion: the existing `query` command, which spawns `claude -p`, sets the var on its child env, and the Stop hook short-circuits when it sees the var set. Without this guard, the query subprocess's internal turns would pollute the parent session's daily log.

## User Stories

1. **As a 2bd user, I want every assistant turn captured to a per-day JSONL file**, so that a separate compile step has raw material to distill durable lessons from.
2. **As a 2bd user, I want capture to be silent and never break my Claude Code session**, so that hook failures (transcript missing, disk full, parse error) produce a log entry under `.2b/state/hook-errors.log` and exit 0 instead of stopping Claude.
3. **As a 2bd user, I want capture to resume across session restarts and skip already-captured turns**, so that closing and reopening Claude Code (or running `/compact`) doesn't produce duplicated turn entries in today's daily log.
4. **As a 2bd user running `2bd query` from inside a session, I want the query subprocess's internal reasoning excluded from my daily log**, so that compile doesn't extract spurious "lessons" from query-internal patterns.
5. **As a 2bd user with two concurrent Claude Code sessions in different worktrees on the same day, I want concurrent Stop-hook invocations to not corrupt the daily log file**, so that captured turns are written atomically and at worst one block is lost on a race rather than producing a malformed file.

## Implementation Decisions

### Hook events

- **`Stop`** is the primary capture event. Survives session crashes and `/clear` (because capture is incremental per turn).
- **`SessionEnd`** is the finalize/flush event. No LLM call (avoids exit latency and removes a foothold for recursion). Job is limited to cursor finalization and writing a session-end marker into the daily log.
- **`PreCompact`** is NOT used. The on-disk transcript survives compaction; PreCompact's value is incremental checkpoint of in-memory context, which the per-turn Stop pattern already provides.
- **`SessionStart`** is unchanged. The existing `assembleContext` already concatenates `.2b/system/*.md`; MEMORY.md is one more file in that directory and gets injected without code changes.

### Hook subcommand surface

The two new hooks register under the existing `hooks` commander subcommand alongside `session-start`:

- `2bd hooks stop`
- `2bd hooks session-end`

### Capture content

- The Stop hook reads `transcript_path` from the stdin JSON payload (documented Claude Code hook contract). Does NOT recompute the path from `cwd` or `CLAUDE_PROJECT_DIR`.
- It reads only the new transcript bytes since a stored byte-offset cursor for this `session_id`.
- For each newly-completed turn, it emits one JSONL line with shape `{ts, session_id, role, content}`. `role` is `user` or `assistant`. `content` is the concatenation of `text` blocks only — `tool_use`, `tool_result`, and `thinking` blocks are dropped.
- No LLM call. Pure file I/O.

### Daily log

- Path: `.2b/state/sessions/YYYY-MM-DD.jsonl`. Local calendar date. One file per day; multiple sessions on the same day append to the same file.
- Format: JSONL, one turn per line.
- Lifecycle: written by Stop hook only. Deletion is the `/compile` skill's responsibility (outside this PRD). 2bd-cli never reads back from this file.

### Cursor store

- Path: `.2b/state/cursors.json`. Single JSON file mapping `session_id` → `{transcript_path, byte_offset, last_updated_iso}`.
- Loaded on each Stop invocation, mutated, written atomically (temp + rename). No file lock.
- SessionEnd writes a final cursor update for the terminating `session_id` and may emit a session-end marker line into the daily log so /compile can detect session boundaries.
- The cursors.json grows with every distinct session_id seen but does not require an eviction policy in v1; the file stays small (one record per session) and can be garbage-collected manually if it ever bloats. A future iteration can prune records older than N days.

### State directory

- Root: `.2b/state/` — gitignored.
- Layout:
  - `.2b/state/sessions/YYYY-MM-DD.jsonl` — daily logs
  - `.2b/state/cursors.json` — cursor store
  - `.2b/state/hook-errors.log` — error log
- The state directory is the first piece of 2bd-owned mutable state. It is created lazily by the Stop hook on first write (atomic `mkdir -p`).

### Read-back

- Unchanged. `assembleContext` already reads `.2b/system/**/*.md` (after a search-step fix if needed — currently reads top-level `.2b/system/*.md`). MEMORY.md will be created by the `/compile` skill at `.2b/system/MEMORY.md`.
- MEMORY.md is missing on first install — `assembleContext` silently skips. The first `/compile` run creates it. No bootstrap step in 2bd-cli.

### Recursion guard

- `TWOBD_HOOK_DISABLED=1` env var, namespaced to 2bd.
- The Stop hook checks `process.env.TWOBD_HOOK_DISABLED === "1"` at entry and exits 0 immediately if set.
- The existing `query` command (`src/commands/query.ts`) sets the env on its `Bun.spawn` child env so the `claude -p` subprocess's internal turns do not get captured.
- Any future 2bd subcommand that spawns `claude -p` follows the same convention.

### Error policy

- All hook errors are caught, written to `.2b/state/hook-errors.log` with timestamp + error message + relevant context (session_id, transcript_path), and exit 0.
- The hook never propagates errors to Claude Code. A failing hook produces a log entry, not a broken session.

### Concurrency

- Daily log writes use atomic write (write-to-temp + rename). Two concurrent Stop hooks on the same day race only on the rename; last-write-wins, worst case one block lost.
- Cursor store uses the same atomic-write strategy.
- No flock. Accepted tradeoff for v1.

### Subprocess pattern

- Hooks do NOT spawn `claude -p`. No LLM work at the hook level. This keeps the hook fast (~50ms target) and removes the recursion footgun at the source.

### Project layout

- New files mirror the existing `session-start` shape:
  - `src/hooks/stop.ts` — hook entry point (`stopAction`)
  - `src/hooks/session-end.ts` — hook entry point (`sessionEndAction`)
  - `src/lib/read-transcript.ts` — read transcript slice from cursor
  - `src/lib/cursor-store.ts` — load/save `.2b/state/cursors.json` atomically
  - `src/lib/daily-log.ts` — append JSONL turns to today's file atomically
  - `src/lib/hook-errors.ts` — error logging helper
  - `src/lib/atomic-write.ts` — shared temp+rename utility
- CLI wiring in `src/cli.ts` adds two new subcommands under the existing `hooks` group.
- Existing `src/commands/query.ts` modified to set `TWOBD_HOOK_DISABLED=1` on its `Bun.spawn` env.
- `.gitignore` entry added: `.2b/state/`.

## Testing Decisions

### What makes a good test

- **Cursor math** is the highest-risk pure logic — tested with unit tests over fixture transcript bytes: empty cursor, mid-file cursor, cursor past end, malformed JSONL line skipped, etc.
- **JSONL serialization** — round-trip tests on each turn shape; assert tool_use/tool_result/thinking blocks are dropped; multi-line content escaped correctly.
- **Atomic write** — race-condition unit test (two `appendTurn` calls in parallel, assert one wins, file is valid JSONL).
- **Hook integration** — end-to-end test piping a fixture stdin JSON payload into the hook, asserting on the resulting daily log and cursor state.
- **Recursion guard** — integration test that runs the Stop hook with `TWOBD_HOOK_DISABLED=1` and asserts no daily log is written.
- **Error path** — integration test with a missing transcript path; assert hook exits 0 and writes to `hook-errors.log`.

### Prior art for tests

- `tests/unit/*.test.ts` — vitest unit tests on each `src/lib/*.ts` module. The new hooks follow `tests/unit/hook-output.test.ts` and `tests/unit/validate-dirs.test.ts` for shape.
- `tests/integration/session-start.integration.test.ts` — drives the CLI end-to-end via `Bun.spawn`, builds a fixture vault in a temp dir, asserts on stdout JSON. The new `tests/integration/stop.integration.test.ts` and `tests/integration/session-end.integration.test.ts` follow this pattern, asserting on `.2b/state/sessions/YYYY-MM-DD.jsonl` and `.2b/state/cursors.json` instead of stdout.

## Out of Scope

- **`/compile` skill.** Distillation of daily logs into MEMORY.md and proposed vault edits is a separate skill living in the vault repo (`.claude/skills/compile/SKILL.md`), not in 2bd-cli. This PRD ends at the JSONL daily log.
- **Vault entity updates.** Updates to People/Projects/Meetings/Resources/Areas are the `/compile` skill's concern and happen with human approval. 2bd-cli writes only to `.2b/state/`.
- **PreCompact hook.** Not used. May be added in a future epic if real usage shows sessions auto-compacting before Stop has captured the pre-compaction turns.
- **MEMORY.md schema/format.** Defined by the `/compile` skill, not by 2bd-cli.
- **Importance scoring, supersedes chains, retrieval ranking.** Out of scope under the rolling-rewrite model — `/compile` rewrites MEMORY.md from scratch each run, so no individual lesson identity is required.
- **Lesson types / `lesson|solution|pattern|preference`.** Lives as sections inside MEMORY.md; not a 2bd-cli concern.
- **Secret redaction.** State directory is gitignored; document the risk in README. Defer regex/gitleaks/Presidio to a future epic.
- **Hook installation.** User edits `~/.claude/settings.json` themselves, same as they did for session-start. No `2bd init-hooks` command.
- **Auto-pruning of `.2b/state/cursors.json`.** Manual GC for v1; add TTL in a future epic if the file grows large.
- **Concurrent-session locking.** Atomic write only; flock deferred.
- **Eval rig.** No staleness-harm index, should-have-recalled corpus, or A/B agent test in v1.
- **Local model offload, prompt caching, batch API.** No LLM at hook level, so cost optimization is the `/compile` skill's concern.

## Further Notes

- The research artifact at `.beastmode/artifacts/research/2026-06-28-session-end-memory-capture.md` is the source of every external decision in this PRD. Re-read it before implementation.
- The opening framing — "SessionEnd hook captures learnings" — was wrong. SessionEnd cannot inject context back into Claude and does not fire on crash; the actual capture mechanism is per-turn Stop with byte-offset cursors. The research artifact's TL;DR walks through why.
- The recursion guard (`TWOBD_HOOK_DISABLED`) is non-optional even though the user initially preferred no guard. The 2bd `query` command provably writes its internal turns to the daily log without it — see research artifact's "Cross-cutting plumbing strategies" section.
- This PRD's scope contracts deliberately. The original concept of "extracted lessons with importance/supersede chains/recency-importance-relevance ranking" was abandoned for the rolling-rewrite model (single MEMORY.md, rewritten by /compile each run). That simpler model is the dominant survivor across all three adversarial lenses in research, and it eliminates 80% of the code surface (no IDs, no dedup logic, no ranking).
- Worktrees fragment the cwd → `~/.claude/projects/<slug>/` mapping silently. The hook reads `transcript_path` from stdin to sidestep this, but be aware that two worktrees of the same repo will produce two separate Claude Code project buckets, and any per-project state 2bd ever adds must account for this.

## Deferred Ideas

- **PreCompact hook** for long sessions that auto-compact before Stop captures the pre-compaction window.
- **Secret redaction** (regex sweep, gitleaks integration, Presidio NER).
- **`2bd init-hooks`** CLI command that auto-edits `~/.claude/settings.json`.
- **TTL-based pruning** of `.2b/state/cursors.json` records older than N days.
- **flock-based concurrency** for the daily log and cursor store.
- **Eval rig** — staleness-harm index, should-have-recalled corpus, memory-on/off A/B comparison.
- **Provenance + trust labeling** on captured turns (source_channel = user_input | tool_output | external_web) for future trust-aware retrieval.
- **Recency · importance · relevance ranking** at SessionStart if rolling-rewrite MEMORY.md ever proves insufficient.
- **Hook-level cost telemetry** (turn count per day, bytes captured, time-per-hook) for eventual cost-tier UX in `/compile`.
