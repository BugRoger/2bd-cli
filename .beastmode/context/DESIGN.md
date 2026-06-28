# Design Context

## Product
CLI for structured context injection (hooks) and LLM-powered vault querying.

context/design/product.md

## Architecture
Thin CLI shell (commander) dispatching to hook orchestrators and command orchestrators. Commands needing LLM capabilities use the `claude -p` subprocess pattern with validation gates, prompt assembly, and tool access control. Mutable 2bd-owned state lives under `.2b/state/` (gitignored), written atomically via a shared primitive; hooks that need to recurse-guard set `TWOBD_HOOK_DISABLED=1` in subprocess env.

context/design/architecture.md

## Tech Stack
Bun + TypeScript + commander. Two production deps (commander, yaml). LLM via `claude -p` subprocess, no SDK.

context/design/tech-stack.md

## Domain Model
Categories, MocRecords, Hook Output, and now Query (prompt assembly + subprocess lifecycle).

context/design/domain-model.md
