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
