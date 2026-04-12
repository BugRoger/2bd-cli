# Changelog

## [0.1.0] - 2026-04-12

First release of `@bugroger/2bd-cli` — a minimal CLI that assembles `.2b/` directory markdown into Claude Code SessionStart hook-compatible JSON.

### Features

- CLI entry point with commander subcommand routing (`2bd hooks session-start`)
- Session-start orchestrator wiring validation and assembly pipeline
- Directory validation module — fails with clear errors for missing `.2b/` or required subdirectories
- Context assembly module — walks system/concepts/instructions in fixed order, sorts files alphabetically, prefixes each with `## .2b/<path>` header
- Hook output module — wraps assembled markdown in Claude Code hook JSON contract

### Fixes

- Add `node_modules/` to `.gitignore` and remove from git tracking
