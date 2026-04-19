# Changelog

## [0.4.0] - 2026-04-19

Adds a top-level `2bd query` command for natural-language vault querying. The command uses index-guided retrieval via `claude -p` subprocess, embedding MOC content in the prompt and returning a cited summary with Obsidian wikilink citations. Supports `--file-back` to write results as vault notes with YAML frontmatter.

### Features

- Add query command module with prompt assembly, tool list construction, and prerequisite validation
- Register `query` as top-level CLI command with `<question>` argument and `--file-back <path>` option
- Integration tests for vault query covering output structure, file-back, and validation scenarios

### Fixes

- Restore MOC discovery in context assembly after regression from commit `9d0e3a9`

## [0.3.0] - 2026-04-17

Extends session-start hook context assembly with automatic MOC (Map of Content) discovery. Numbered top-level directories matching `/^\d{2} /` are scanned recursively for markdown files with `type: moc` YAML frontmatter, and their contents are appended to the assembled context output.

### Features

- Add MOC discovery module with recursive directory scanning, symlink safety, and `Intl.Collator` natural sort
- Integrate MOC sections into context assembly pipeline after `.2b/` category content

## [0.2.0] - 2026-04-15

Adds runtime date context injection — the session-start hook now emits a human-readable "Today's date is ..." sentence, giving Claude accurate temporal awareness without manual configuration.

### Features

- Integrate date sentence into assembled session context output
- Add date formatting module (`formatDateSentence`) with timezone-aware `Intl.DateTimeFormat` formatting

### Fixes

- Widen timezone regex to accept offset-style abbreviations (e.g., `GMT+2`, `UTC-5`)

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
