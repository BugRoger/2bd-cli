# Architecture

## Overview
Thin CLI shell (commander) dispatching to per-hook orchestrator functions. Each orchestrator composes pure library modules (validate -> assemble -> format).

## Components
| Module | Path | Responsibility |
|--------|------|----------------|
| CLI entry | src/cli.ts | Commander setup, command registration |
| Session-start orchestrator | src/hooks/session-start.ts | Validates dirs, assembles context, writes JSON to stdout |
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

## Boundaries
- stdin: not used
- stdout: JSON only (hook contract)
- stderr: error messages only
- filesystem: read-only (.2b/ directory and numbered top-level directories)
