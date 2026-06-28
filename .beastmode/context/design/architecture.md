# Architecture

## Overview
Thin CLI shell (commander) dispatching to per-hook orchestrator functions. Each orchestrator composes pure library modules (validate -> assemble -> format).

## Components
| Module | Path | Responsibility |
|--------|------|----------------|
| CLI entry | src/cli.ts | Commander setup, command registration |
| Query command | src/commands/query.ts | Validates prereqs, assembles prompt, spawns `claude -p` subprocess |
| Session-start orchestrator | src/hooks/session-start.ts | Validates dirs, assembles context, writes JSON to stdout |
| Stop hook orchestrator | src/hooks/stop.ts | Reads transcript slice since cursor, appends turn records to today's daily log, advances cursor; silent on any failure |
| Session-end hook orchestrator | src/hooks/session-end.ts | Finalizes cursor for the terminating session_id, appends session-end marker to today's daily log |
| Atomic write primitive | src/lib/atomic-write.ts | `atomicWriteFile(path, data)` — temp file in same dir + rename |
| Cursor store | src/lib/cursor-store.ts | Load/save `.2b/state/cursors.json` (session_id -> {transcript_path, byte_offset, last_updated_iso}) |
| Daily log writer | src/lib/daily-log.ts | Append turn records / session-end markers to `.2b/state/sessions/YYYY-MM-DD.jsonl` |
| Transcript slice parser | src/lib/read-transcript.ts | Read transcript bytes since offset, emit one record per completed turn (text blocks only) |
| Hook error logger | src/lib/hook-error-log.ts | Append timestamped JSONL entries to `.2b/state/hook-errors.log` |
| Directory validation | src/lib/validate-dirs.ts | Checks .2b/ and required subdirs exist |
| Context assembly | src/lib/assemble-context.ts | Discovers .2b/ .md files, calls MOC discovery, concatenates with headers |
| MOC discovery | src/lib/discover-mocs.ts | Scans numbered top-level dirs (`/^\d{2} /`) for markdown with `type: moc` frontmatter, returns sorted MocRecord[] |
| Hook output | src/lib/hook-output.ts | Wraps markdown in Claude Code hook JSON contract |
| Date formatting | src/lib/format-date.ts | Pure function producing English date sentence from Date object via Intl.DateTimeFormat |

## Data Flow
CLI -> orchestrator -> validateDirs(cwd) -> assembleContext(cwd, now?) -> buildHookOutput(markdown) -> stdout

`assembleContext` internally calls `discoverMocs(basePath)` after the `.2b/` category loop. Accepts optional `now?: Date` for testability; defaults to `new Date()`. The date sentence is always the first content in the assembled output.

## Key Decisions
- `.2b/` category discovery is flat (no recursion into nested dirs)
- MOC discovery recurses into numbered top-level directories with unlimited depth
- MOC files identified by `type: moc` in YAML frontmatter (parsed with `yaml` package)
- Symbolic links skipped during MOC recursive traversal (via `lstat` checks)
- MOC files sorted by full relative path using `Intl.Collator` with `numeric: true`
- Fixed category order: system -> concepts -> instructions
- Assembled output order: date sentence -> .2b/ categories -> MOC files
- No configuration file for v1
- Exit non-zero with stderr for missing directories

## LLM Subprocess Pattern (claude -p)

Commands that need LLM capabilities use `claude -p` spawned via `Bun.spawn` as an agentic subprocess rather than importing the Anthropic SDK directly. This reuses the user's existing Claude Code CLI authentication and model configuration.

### Components
| Component | Mechanism |
|-----------|-----------|
| Main prompt | First positional argument to `claude -p` -- contains embedded context (e.g., MOC content) plus the user's query |
| System prompt | `--append-system-prompt` flag -- controls output format, citation conventions, and mode-specific instructions |
| Tool access | `--allowedTools` flag -- comma-separated list; varies by mode (e.g., read-only vs. read-write) |
| Working directory | `cwd` option on `Bun.spawn` -- set to vault root for correct tool path resolution |
| Exit code | Propagated from subprocess to CLI process |

### Validation Gate
Three prerequisite checks run before any subprocess is spawned:
1. `.2b/` directory structure exists (reuses `validateDirs`)
2. `claude` CLI is resolvable on PATH (via `Bun.which` with `whichFn` injection for testability)
3. Domain-specific content exists (e.g., at least one MOC file discovered)

### Testability
- Helper functions (`buildSystemPrompt`, `buildMainPrompt`, `buildToolList`, `validateQueryPrereqs`) are exported and unit-tested independently
- `whichFn` dependency injection allows testing the claude-not-found validation path without modifying the real PATH
- Integration tests verify structural output properties (exit code, wikilink pattern, YAML frontmatter validity) not exact LLM content, because output is non-deterministic

### Recursion Guard
Any 2bd subcommand that spawns `claude -p` MUST inject `TWOBD_HOOK_DISABLED=1` into the subprocess env (merged with `process.env`). The Claude Code hooks shipped by 2bd-cli short-circuit to exit 0 when they see this sentinel set, preventing the inner session's per-turn hook firings from polluting the outer session's state. The env-var namespace prefix is `TWOBD_`.

## State Directory (.2b/state/)

The vault's hidden, gitignored area for 2bd-owned mutable state. Distinct from `.2b/{system,concepts,instructions}/` which are user-curated content. Conventions:

- All writes go through the `atomicWriteFile` primitive (temp file in the same directory + rename) so partial files are never visible to readers.
- Subdirectories and parent files are created lazily by whichever module writes first (`mkdir -p`); no eager bootstrap.
- Files are never read back by 2bd-cli itself in v1 — they exist as raw material for downstream skills.
- Layout today: `.2b/state/sessions/YYYY-MM-DD.jsonl` (daily session capture), `.2b/state/cursors.json` (per-session byte-offset cursors), `.2b/state/hook-errors.log` (silent-failure log).
- `.2b/state/` MUST be gitignored; any new state file added here inherits that.

See also: [worktree-claude-project-bucket](architecture/2026-06-28-worktree-claude-project-bucket.md) — why hooks read `transcript_path` from stdin rather than recomputing.

## Boundaries
- stdin: not used
- stdout: JSON (hook contract) or markdown (query output)
- stderr: error messages only
- filesystem: read-only (.2b/ directory and numbered top-level directories); read-write when query --file-back is used (Claude subprocess writes the file)
