---
phase: design
epic-id: bm-8ca0
epic-slug: parsed-xenon-8ca0
epic-name: Vault Query Command
---

## Problem Statement

There is no way to query the Obsidian vault from the CLI. Finding information requires manually browsing MOC files and individual notes. Users need a command that accepts a natural-language question, searches the vault intelligently, and returns a cited summary — optionally filing the result back as a vault note.

## Solution

A top-level `2bd query` command that uses index-guided retrieval. The CLI reads all MOC files from the vault, embeds them in a prompt, and spawns `claude -p` as an agentic subprocess with Read/Glob/Grep tool access. Claude examines the MOCs, reads relevant vault documents via its tools, and synthesizes an answer with Obsidian-style wikilink citations. The result prints to stdout by default, or writes to a vault note file when `--file-back` is specified.

## User Stories

1. As a user, I want to run `2bd query "what do I know about OAuth token rotation"` and get a summary with citations from my vault, so that I can quickly find and synthesize information without manually browsing.

2. As a user, I want to run `2bd query "summarize my Q1 goals" --file-back "30 Resources/Q1 Goals Summary.md"` and have the result written as a proper vault note with YAML frontmatter, so that query results become part of my knowledge base.

3. As a user, I want citations in the output to use Obsidian wikilinks (`[[path/to/doc]]`), so that I can click through to source documents when viewing the result in Obsidian.

4. As a user, I want to pipe the output (`2bd query "..." | pbcopy`) and get clean markdown without decorative output, so that I can compose the command with other tools.

5. As a user, I want clear error messages when the vault structure is invalid or the `claude` CLI is not available, so that I can diagnose setup issues quickly.

## Implementation Decisions

- **Command shape**: Top-level command `2bd query <question> [--file-back <path>]`. Not nested under a group.
- **Vault location**: Resolved from cwd, same pattern as `2bd hooks session-start`. The vault root is the directory containing `.2b/`.
- **LLM integration**: Spawn `claude -p` subprocess via `Bun.spawn`. No Anthropic SDK dependency. Reuses the user's existing Claude Code CLI authentication and model configuration.
- **Model selection**: Uses the user's default Claude Code model. No `--model` flag.
- **Retrieval strategy**: Single agentic `claude -p` call. The CLI reads MOC files via `discover-mocs.ts` and embeds their content in the prompt. Claude uses Read/Glob/Grep tools to access vault documents it deems relevant, then synthesizes the answer.
- **Tool access**: `--allowedTools "Read,Glob,Grep"` by default. When `--file-back` is specified, add `Write,Edit` so Claude can write the output file itself.
- **Prompt structure**: System prompt (via `--append-system-prompt`) instructs Claude on citation format, vault conventions, and output structure. The main prompt contains the embedded MOC content and the user's query.
- **Path resolution**: `claude -p` runs with cwd set to the vault root so that Read tool paths resolve correctly against wikilink references.
- **Citation format**: Obsidian-style wikilinks `[[path/to/document]]` without `.md` extension, consistent with vault conventions.
- **stdout output**: Raw markdown answer printed to stdout. No decorative output. Pipe-friendly.
- **--file-back behavior**: When specified, Claude writes the result to the given path (resolved relative to vault root) as a vault note with full YAML frontmatter schema (title, type, tags, created, updated). Output goes to file instead of stdout.
- **Progress indication**: Silent. No progress output while Claude runs.
- **MOC discovery**: Uses existing `discover-mocs.ts` module. Scans numbered top-level directories (`/^\d{2} /`) recursively for files with `type: moc` frontmatter. No changes to the discovery logic.
- **Validation**: Before spawning claude, validate: (1) `.2b/` directory exists, (2) `claude` CLI is on PATH, (3) at least one MOC file was discovered.
- **Error handling**: Exit 1 with stderr message on validation failure or non-zero claude exit code.

## Testing Decisions

- **Unit tests**: Test prompt assembly (MOC embedding, system prompt construction), argument parsing (query extraction, --file-back path resolution), and tool list construction (read-only vs. read-write based on --file-back).
- **Integration tests**: Spawn a real `2bd query` process against a fixture vault with known MOC files and documents. Verify exit code, output structure, and --file-back file creation.
- **Prior art**: Follow existing test patterns in `tests/unit/` and `tests/integration/`. Use temp directories for fixture vaults. Vitest as the test runner.
- **LLM output is non-deterministic**: Integration tests should verify structural properties (exit code, file existence, frontmatter validity) rather than exact content.

## Out of Scope

- Model selection flag (`--model`)
- Vault path override (`--vault`)
- Multi-pass retrieval (two or three separate LLM calls)
- Embedding-based or vector search
- Query history or cost tracking
- Streaming output
- Progress indicators

## Further Notes

The prior art (coleam00/claude-memory-compiler query.py) uses a similar index-guided retrieval approach but with the Anthropic SDK directly. This implementation delegates to the Claude Code CLI instead, which simplifies auth, model config, and tool access at the cost of requiring the CLI to be installed.

## Deferred Ideas

- Query cost tracking and audit log (as in the prior art)
- Automatic MOC update when --file-back creates a new note
- Interactive follow-up queries (conversational mode)
- Caching of MOC content between queries
