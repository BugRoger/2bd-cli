# Product

## Vision
Minimal CLI tool for injecting structured project context into Claude Code sessions via hooks, and for querying vault knowledge via LLM-powered retrieval.

## Goals
- Zero-install usage via `bunx @bugroger/2bd-cli`
- Convention-over-configuration: `.2b/` directory with fixed category structure
- Claude Code hook contract compliance (SessionStart)
- MOC-guided vault querying with cited summaries

## Core Capabilities
- Context assembly from `.2b/{system,concepts,instructions}/*.md`
- MOC discovery from numbered Obsidian-style top-level directories (`/^\d{2} /` pattern) -- markdown files with `type: moc` YAML frontmatter are auto-included
- Runtime date/time injection (always-on, English, 24-hour clock, system timezone)
- Hook-compatible JSON output to stdout
- `2bd query <question>` -- natural-language vault query with Obsidian wikilink citations via `claude -p` subprocess
- `--file-back <path>` -- write query results as vault notes with YAML frontmatter

## Differentiators
- Two production dependencies (commander, yaml)
- No configuration file required for v1
- Flat, predictable directory convention with optional Obsidian vault integration
- LLM integration via CLI subprocess (no SDK dependency) -- reuses user's existing Claude Code auth and model config
