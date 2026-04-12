# Product

## Vision
Minimal CLI tool for injecting structured project context into Claude Code sessions via hooks.

## Goals
- Zero-install usage via `bunx @bugroger/2bd-cli`
- Convention-over-configuration: `.2b/` directory with fixed category structure
- Claude Code hook contract compliance (SessionStart)

## Core Capabilities
- Context assembly from `.2b/{system,concepts,instructions}/*.md`
- Hook-compatible JSON output to stdout

## Differentiators
- Single production dependency (commander)
- No configuration file required for v1
- Flat, predictable directory convention
