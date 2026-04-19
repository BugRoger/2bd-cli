---
phase: release
epic-id: vault-query-command-8ca0
epic-slug: vault-query-command-8ca0
bump: minor
---

# Release: vault-query-command-8ca0

**Bump:** minor
**Date:** 2026-04-19

## Highlights

Adds a top-level `2bd query` command that accepts a natural-language question, searches the Obsidian vault using index-guided retrieval via `claude -p`, and returns a cited summary with Obsidian wikilink citations. Supports `--file-back` to write results as vault notes with YAML frontmatter.

## Features

- Add query command module with prompt assembly, tool list construction, and validation (`25f4504`)
- Register query command as top-level CLI command with `<question>` argument and `--file-back <path>` option (`252f5fd`)
- Integration tests for vault query command covering query output, file-back, and validation scenarios (`b441264`, `165c449`)

## Fixes

- Restore MOC discovery in context assembly after regression from `9d0e3a9` (repair during validation)

## Chores

- Design artifact for vault query command (`ccfd2d3`)
- Plan artifact with feature decomposition and integration test scenarios (`f05b122`)
- Implementation checkpoint (`34d9d7d`)
- Validation checkpoint (`9c880e5`)

## Full Changelog

- `9d0e3a9` Remove MOC discovery from context assembly
- `ccfd2d3` design(parsed-xenon-8ca0): checkpoint
- `f05b122` plan(vault-query-command-8ca0): checkpoint
- `b441264` test(query): add integration tests for vault query command (RED)
- `25f4504` feat(query): add query command module with prompt assembly, tool list, and validation
- `252f5fd` feat(query): register query command in CLI entry point
- `165c449` test(query): integration tests GREEN for vault query command
- `34d9d7d` implement(vault-query-command-8ca0--vault-query-command-8ca0.1): checkpoint
- `9c880e5` validate(vault-query-command-8ca0): checkpoint (#13)
