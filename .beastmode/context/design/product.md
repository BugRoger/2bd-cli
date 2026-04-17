# Product

## Vision
Minimal CLI tool for injecting structured project context into Claude Code sessions via hooks.

## Goals
- Zero-install usage via `bunx @bugroger/2bd-cli`
- Convention-over-configuration: `.2b/` directory with fixed category structure
- Claude Code hook contract compliance (SessionStart)

## Core Capabilities
- Context assembly from `.2b/{system,concepts,instructions}/*.md`
- MOC discovery from numbered Obsidian-style top-level directories (`/^\d{2} /` pattern) -- markdown files with `type: moc` YAML frontmatter are auto-included
- Runtime date/time injection (always-on, English, 24-hour clock, system timezone)
- Hook-compatible JSON output to stdout

## Differentiators
- Two production dependencies (commander, yaml)
- No configuration file required for v1
- Flat, predictable directory convention with optional Obsidian vault integration
