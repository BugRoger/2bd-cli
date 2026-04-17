# Changelog

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
