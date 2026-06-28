# Worktrees Fragment Claude Code's Project Bucket Mapping (2026-06-28)

## Observation

Claude Code derives its on-disk transcript directory (`~/.claude/projects/<slug>/`) from cwd. Two git worktrees of the same repo produce two different slugs and therefore two separate Claude Code project buckets, with independent transcripts and independent session histories.

## Implication

- Hooks that need the transcript path MUST read `transcript_path` from the stdin payload Claude Code provides — never recompute it from `cwd` or `CLAUDE_PROJECT_DIR`.
- Any per-project state that 2bd-cli ever adds outside the repo's own `.2b/state/` (e.g. global caches keyed by project) must account for the worktree fan-out, or the same logical project will appear under multiple keys.

## Surfaced By

Session-end memory capture hooks epic (bm-f8ce). Resolved by reading `transcript_path` from stdin instead of deriving it.
