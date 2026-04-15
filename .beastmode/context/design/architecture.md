# Architecture

## Overview
Thin CLI shell (commander) dispatching to per-hook orchestrator functions. Each orchestrator composes pure library modules (validate -> assemble -> format).

## Components
| Module | Path | Responsibility |
|--------|------|----------------|
| CLI entry | src/cli.ts | Commander setup, command registration |
| Session-start orchestrator | src/hooks/session-start.ts | Validates dirs, assembles context, writes JSON to stdout |
| Directory validation | src/lib/validate-dirs.ts | Checks .2b/ and required subdirs exist |
| Context assembly | src/lib/assemble-context.ts | Discovers .md files, sorts, reads, concatenates with headers |
| Hook output | src/lib/hook-output.ts | Wraps markdown in Claude Code hook JSON contract |
| Date formatting | src/lib/format-date.ts | Pure function producing English date sentence from Date object via Intl.DateTimeFormat |

## Data Flow
CLI -> orchestrator -> validateDirs(cwd) -> assembleContext(cwd, now?) -> buildHookOutput(markdown) -> stdout

Note: `assembleContext` accepts an optional `now?: Date` parameter for testability; defaults to `new Date()`. The date sentence is always the first content in the assembled output.

## Key Decisions
- Flat file discovery only (no recursion into nested dirs)
- Fixed category order: system -> concepts -> instructions
- No configuration file for v1
- Exit non-zero with stderr for missing directories

## Boundaries
- stdin: not used
- stdout: JSON only (hook contract)
- stderr: error messages only
- filesystem: read-only (.2b/ directory)
