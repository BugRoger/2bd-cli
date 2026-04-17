---
phase: release
epic-id: bm-0ccc
epic-slug: moc-context-assembly-0ccc
bump: minor
---

# Release: moc-context-assembly-0ccc

**Bump:** minor
**Date:** 2026-04-17

## Highlights

Extends the session-start hook to automatically discover and include Obsidian-style Maps of Content (MOC) files in Claude Code session context. Numbered top-level directories are scanned for markdown files with `type: moc` frontmatter, and their contents are appended to the assembled context output.

## Features

- feat(moc-discovery): add MOC discovery module with unit tests
- feat(moc-discovery): integrate MOC sections into context assembly

## Chores

- deps: add yaml package for YAML frontmatter parsing
- test(moc-discovery): add integration tests for MOC discovery and assembly (RED)
- design(sharded-zilch-0ccc): checkpoint
- plan(moc-context-assembly-0ccc): checkpoint
- implement(moc-context-assembly-0ccc--moc-discovery-and-assembly-0ccc.1): checkpoint
- validate(moc-context-assembly-0ccc): checkpoint

## Full Changelog

9e8caf7..832651c
