# Error Handling

## Error Types
- Missing `.2b/` directory
- Missing required subdirectory (system, concepts, instructions)
- I/O errors reading files

## Recovery Strategy
- Fail fast with non-zero exit code
- No retry logic -- filesystem errors are deterministic in this context

## User-Facing Errors
- Written to stderr with descriptive message identifying the specific missing directory
- Format: `Error: Required directory ".2b/<subdir>/" not found in <basePath>`

## Logging
- No logging framework -- stderr for errors, stdout for JSON output only
