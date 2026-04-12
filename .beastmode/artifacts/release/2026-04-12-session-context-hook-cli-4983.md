---
phase: release
epic-id: session-context-hook-cli-4983
epic-slug: session-context-hook-cli-4983
version: v0.1.0
---

# Release: session-context-hook-cli-4983

**Version:** v0.1.0
**Date:** 2026-04-12

## Highlights

First release of `@bugroger/2bd-cli` — a minimal CLI that assembles `.2b/` directory markdown into Claude Code SessionStart hook-compatible JSON. Run `bunx @bugroger/2bd-cli hooks session-start` to inject structured project context into every Claude session.

## Features

- CLI entry point with commander subcommand routing (`2bd hooks session-start`)
- Session-start orchestrator wiring validation and assembly pipeline
- Directory validation module — fails with clear errors for missing `.2b/` or required subdirectories
- Context assembly module — walks system/concepts/instructions in fixed order, sorts files alphabetically, prefixes each with `## .2b/<path>` header
- Hook output module — wraps assembled markdown in Claude Code hook JSON contract

## Fixes

- Add `node_modules/` to `.gitignore` and remove from git tracking

## Full Changelog

```
42ae9d0 fix(validate): add node_modules/ to .gitignore and remove from tracking
fadd10e validate(session-context-hook-cli-4983): checkpoint
7c32d5c implement(session-context-hook-cli-4983--context-assembly-cli-4983.1): checkpoint
e23cece test(context-assembly): integration tests GREEN
7a3d28d feat(context-assembly): add CLI entry point with commander
b05af78 feat(context-assembly): add session-start orchestrator
9624f10 feat(context-assembly): add directory validation module with tests
bfdf1c9 feat(context-assembly): add context assembly module with tests
0ec7452 feat(context-assembly): add hook output module with tests
3e5f409 chore(context-assembly): scaffold package.json and tsconfig.json
7b55e8a test(context-assembly): add integration tests for hooks session-start (RED)
a31a40a plan(session-context-hook-cli-4983): checkpoint
01f917a design(owned-wyrm-4983): checkpoint
```
