---
phase: design
epic-id: bm-4983
epic-slug: session-context-hook-cli-4983
epic-name: Session Context Hook CLI
---

## Problem Statement

Claude Code sessions start without project-specific context. There is no lightweight, self-contained way to inject structured knowledge into Claude's system context at session start. Users must either rely on CLAUDE.md conventions or build custom tooling from scratch.

## Solution

A minimal CLI tool (`@bugroger/2bd-cli`) distributed via npm that walks a `.2b/` directory structure, reads markdown files organized by category (system, concepts, instructions), and outputs Claude Code hook-compatible JSON. Invoked as `2bd hooks session-start`, it assembles context from `.2b/{system,concepts,instructions}/*.md` in a fixed category order, with files sorted alphabetically within each category. The output is a JSON object with `hookSpecificOutput.additionalContext` containing the concatenated markdown, ready for injection into Claude's system context.

## User Stories

1. As a developer, I want to run `bunx @bugroger/2bd-cli hooks session-start` without any prior installation, so that I can use the tool immediately in any project.

2. As a developer, I want to configure `2bd hooks session-start` as a Claude Code SessionStart hook, so that my project context is automatically injected into every Claude session.

3. As a developer, I want to organize my project context into `.2b/system/`, `.2b/concepts/`, and `.2b/instructions/` directories, so that context is loaded in a predictable order (system → concepts → instructions).

4. As a developer, I want the CLI to fail with a clear error if `.2b/` or any of its required subdirectories are missing, so that I know immediately when my project isn't configured correctly.

5. As a developer, I want each file in the output to be prefixed with its relative path as a markdown header, so that I can trace which file contributed each section of the injected context.

## Implementation Decisions

- **Runtime**: Bun with TypeScript in strict mode, ESM-only, target esnext
- **CLI framework**: commander (single production dependency) for subcommand routing, help text, and argument parsing
- **Subcommand structure**: Extensible pattern — `2bd <command> <subcommand>`. First command is `hooks` with subcommand `session-start`. New top-level commands can be added later.
- **Distribution**: Published to npm as `@bugroger/2bd-cli` with `bin.2bd` entry. Users invoke via `bunx @bugroger/2bd-cli` (no global install needed)
- **Directory convention**: `.2b/` in the working directory with three required subdirectories: `system/`, `concepts/`, `instructions/`
- **File discovery**: Flat only — reads direct children of each subdirectory, no recursion into nested dirs. Only `.md` files are picked up. Files sorted alphabetically within each category.
- **Category ordering**: Fixed: system → concepts → instructions. No configuration.
- **Output format**: JSON to stdout matching Claude Code hook contract:
  ```json
  {
    "hookSpecificOutput": {
      "hookEventName": "SessionStart",
      "additionalContext": "<concatenated markdown>"
    }
  }
  ```
- **File delimiters in output**: Each file prefixed with `## <relative-path>` (e.g., `## .2b/system/persona.md`) followed by file contents. No category-level headers.
- **Error behavior**: Exit non-zero with descriptive stderr message if `.2b/` directory or any required subdirectory is missing. Exit non-zero for I/O errors or unreadable files.
- **No configuration file**: Behavior is hardcoded for v1. Configurability is a future concern.

## Testing Decisions

- **Framework**: vitest (dev dependency only)
- **Unit tests**: Test context assembly logic in isolation — given a directory structure, verify correct file discovery, ordering, concatenation, and JSON output
- **Integration tests**: Create temporary `.2b/` directory structures, invoke the CLI as a subprocess, assert stdout JSON and exit codes
- **Error case tests**: Missing `.2b/`, missing subdirs, empty directories, non-markdown files (should be ignored), unreadable files
- **No snapshot tests**: Output is deterministic given input, so direct assertion is simpler

## Out of Scope

- Configuration file support (`.2bd.yaml` or similar)
- Recursive subdirectory traversal
- Non-markdown file types (`.yaml`, `.txt`, etc.)
- Category-level section headers in output
- Custom category ordering
- File filtering or exclusion patterns
- Other hook types (PreToolUse, PostToolUse, etc.)
- Compiled binary distribution
- Watch mode or hot reload

## Further Notes

None

## Deferred Ideas

- Configurable context sources via a `.2bd.yaml` config file
- Support for additional hook events beyond session-start
- Recursive directory traversal option
- Support for `.yaml`, `.txt`, and other text file types
- Compiled binary distribution via `bun build --compile` for truly zero-runtime usage
- Template/scaffolding command (`2bd init`) to bootstrap a `.2b/` directory structure
