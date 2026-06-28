# Error Handling

## Error Types
- Missing `.2b/` directory
- Missing required subdirectory (system, concepts, instructions)
- I/O errors reading files
- Missing external CLI dependency (`claude` not on PATH)
- Missing domain content (no MOC files discovered)
- LLM subprocess non-zero exit code

## Recovery Strategy
- Fail fast with non-zero exit code
- No retry logic -- filesystem errors are deterministic in this context
- LLM subprocess exit codes are propagated directly

## User-Facing Errors
- Written to stderr with descriptive message identifying the specific failure
- Format examples:
  - `Error: Required directory ".2b/<subdir>/" not found in <basePath>`
  - `Error: The "claude" CLI is not available on PATH. Install it from ...`
  - `Error: No MOC files found. Create at least one markdown file with "type: moc" YAML frontmatter ...`

## Logging
- No logging framework -- stderr for errors, stdout for JSON output (hooks) or markdown output (query) only

## Validation Gate Pattern
- Commands with external dependencies (LLM subprocess, external CLIs) validate all prerequisites BEFORE spawning any subprocess
- Validation checks are ordered by cost: cheapest checks first (directory existence), then external tool checks (PATH lookup), then content checks (MOC discovery)
- Each check produces a distinct, actionable error message

## Hook Silent-Failure Policy
- Claude Code hooks (subcommands under `2bd hooks`) MUST never propagate errors to Claude Code. Every error path — malformed stdin payload, missing transcript, write failure, uncaught exception — is caught at the top level, written to `.2b/state/hook-errors.log` with a timestamp + message + context fields, and the hook exits 0. A failing hook produces a log entry, never a broken session.
- Hooks also MUST NOT call `validateDirs` or otherwise gate on vault structure. A hook firing in a non-vault repo exits 0 silently — no `.2b/state/` to write to means no work to do, not an error.
