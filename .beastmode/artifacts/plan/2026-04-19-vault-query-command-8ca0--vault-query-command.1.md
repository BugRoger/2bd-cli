---
phase: plan
epic-id: vault-query-command-8ca0
epic-slug: vault-query-command-8ca0
feature-name: Vault Query Command
wave: 1
---

# Vault Query Command

**Design:** `.beastmode/artifacts/design/2026-04-19-vault-query-command-8ca0.md`

## User Stories

1. As a user, I want to run `2bd query "what do I know about OAuth token rotation"` and get a summary with citations from my vault, so that I can quickly find and synthesize information without manually browsing.

2. As a user, I want to run `2bd query "summarize my Q1 goals" --file-back "30 Resources/Q1 Goals Summary.md"` and have the result written as a proper vault note with YAML frontmatter, so that query results become part of my knowledge base.

3. As a user, I want citations in the output to use Obsidian wikilinks (`[[path/to/doc]]`), so that I can click through to source documents when viewing the result in Obsidian.

4. As a user, I want to pipe the output (`2bd query "..." | pbcopy`) and get clean markdown without decorative output, so that I can compose the command with other tools.

5. As a user, I want clear error messages when the vault structure is invalid or the `claude` CLI is not available, so that I can diagnose setup issues quickly.

## What to Build

**Architectural Decisions (cross-cutting constraints):**

| Decision | Choice |
|----------|--------|
| Command shape | Top-level `program.command("query")`, not nested under a group |
| LLM integration | Spawn `claude -p` subprocess via `Bun.spawn` — no Anthropic SDK dependency |
| Tool access | `--allowedTools "Read,Glob,Grep"` by default; add `Write,Edit` when `--file-back` is specified |
| Prompt structure | System prompt via `--append-system-prompt`; main prompt contains embedded MOC content + user query |
| Vault resolution | cwd-based `.2b/` detection, same pattern as session-start |
| Output contract | Raw markdown to stdout, no decorative output, pipe-friendly |
| Citation format | Obsidian wikilinks `[[path/to/document]]` without `.md` extension |

**New command module — query action:** An async action function that implements the full query pipeline:

1. **Validation:** Check three prerequisites in order: (a) `.2b/` directory exists at cwd, (b) `claude` CLI is resolvable on PATH (use `Bun.which` or equivalent), (c) at least one MOC file is discovered via the existing `discoverMocs` module. On any failure, write a descriptive error to stderr and exit 1. No subprocess is spawned if validation fails.

2. **Prompt assembly:** Build two prompt components:
   - **System prompt:** Instructions for Claude on citation format (wikilinks without `.md`), vault conventions, and output structure (clean markdown, no decorative output). When `--file-back` is specified, additional instructions for writing the result as a vault note with YAML frontmatter (title, type, tags, created, updated fields).
   - **Main prompt:** Embed all discovered MOC content (relative path + body, same format as `assembleContext` uses) followed by the user's query string.

3. **Subprocess invocation:** Spawn `claude -p "<main-prompt>" --append-system-prompt "<system-prompt>" --allowedTools "<tool-list>"` via `Bun.spawn` with cwd set to the vault root (the directory containing `.2b/`). The tool list is `Read,Glob,Grep` by default, extended with `Write,Edit` when `--file-back` is specified. When `--file-back` is present, the prompt instructs Claude to write the result to the specified path (resolved relative to vault root) instead of returning it as output.

4. **Output handling:** Capture stdout from the subprocess and write it directly to the CLI's stdout. No post-processing, no decoration. When `--file-back` is specified, Claude writes the file itself via its Write tool — the CLI does not write the file. Stdout may be empty or minimal in file-back mode.

5. **Error propagation:** If the subprocess exits non-zero, propagate the exit code. Write any subprocess stderr content to the CLI's stderr.

**Command registration:** Register `query` as a top-level command on the Commander program with a required `<question>` argument and an optional `--file-back <path>` option. Follow the existing pattern in `cli.ts`.

**Unit tests for the new module:**
- Prompt assembly: verify MOC content embedding, system prompt content, query inclusion
- Argument parsing: verify question extraction, --file-back path resolution
- Tool list construction: verify read-only set vs. read-write set based on --file-back presence
- Validation logic: verify each prerequisite check produces the correct error message

**Integration tests:** Implement the 10 Gherkin scenarios from the integration artifact as Vitest integration tests following the existing `runCli` + temp directory pattern. LLM output is non-deterministic — tests verify structural properties (exit code, file existence, frontmatter validity, wikilink pattern presence) not exact content.

## Integration Test Scenarios

```gherkin
@vault-query-command-8ca0 @query
Feature: Vault query command -- queries the vault and returns a cited summary

  Background:
    Given a temporary vault directory with a valid .2b/ category structure
    And the .2b/system/ directory contains a markdown file with system content
    And a top-level directory named "10 Projects" exists in the vault
    And "10 Projects" contains a markdown file with "type: moc" YAML frontmatter
    And the vault contains at least one document referenced by a MOC file
    And the CLI entry point is available as "2bd"
    And the "claude" CLI is available on PATH

  Scenario: Querying the vault returns a summary on stdout with zero exit code
    When the user runs "2bd query 'what do I know about testing strategies'"
    Then the exit code is 0
    And stdout contains non-empty markdown content
    And stderr is empty

  Scenario: Query output includes Obsidian wikilink citations
    When the user runs "2bd query 'what do I know about testing strategies'"
    Then the exit code is 0
    And stdout contains at least one Obsidian wikilink matching the pattern "[[path/to/document]]"
    And no wikilink path ends with ".md"

  Scenario: Query output is clean markdown suitable for piping
    When the user runs "2bd query 'summarize my projects'"
    Then the exit code is 0
    And stdout does not contain ANSI escape codes
    And stdout does not contain progress indicators or spinner characters
    And stdout is valid markdown
```

```gherkin
@vault-query-command-8ca0 @file-back
Feature: Vault query file-back -- writes query result as a vault note

  Background:
    Given a temporary vault directory with a valid .2b/ category structure
    And the .2b/system/ directory contains a markdown file with system content
    And a top-level directory named "10 Projects" exists in the vault
    And "10 Projects" contains a markdown file with "type: moc" YAML frontmatter
    And the vault contains at least one document referenced by a MOC file
    And the CLI entry point is available as "2bd"
    And the "claude" CLI is available on PATH

  Scenario: File-back flag writes the result to the specified vault path
    When the user runs "2bd query 'summarize my projects' --file-back '30 Resources/Project Summary.md'"
    Then the exit code is 0
    And a file exists at "30 Resources/Project Summary.md" relative to the vault root
    And the file contains non-empty markdown content

  Scenario: File-back output includes valid YAML frontmatter
    When the user runs "2bd query 'summarize my projects' --file-back '30 Resources/Project Summary.md'"
    Then the exit code is 0
    And the file at "30 Resources/Project Summary.md" begins with YAML frontmatter delimiters
    And the YAML frontmatter is valid YAML
    And the YAML frontmatter contains a "title" field
    And the YAML frontmatter contains a "type" field
    And the YAML frontmatter contains a "created" field

  Scenario: File-back output does not go to stdout
    When the user runs "2bd query 'summarize my projects' --file-back '30 Resources/Project Summary.md'"
    Then the exit code is 0
    And stdout is empty or contains no query result content
    And a file exists at "30 Resources/Project Summary.md" relative to the vault root
```

```gherkin
@vault-query-command-8ca0 @validation
Feature: Vault query validation -- reports prerequisite failures clearly

  Background:
    Given a temporary working directory
    And the CLI entry point is available as "2bd"

  Scenario: Fails with clear error when .2b/ directory is missing
    Given the working directory has no ".2b/" directory
    When the user runs "2bd query 'any question'"
    Then the exit code is non-zero
    And stderr contains a message indicating the vault structure is invalid

  Scenario: Fails with clear error when the claude CLI is not on PATH
    Given a valid vault directory with .2b/ structure and at least one MOC file
    And the "claude" CLI is not available on PATH
    When the user runs "2bd query 'any question'"
    Then the exit code is non-zero
    And stderr contains a message indicating the "claude" CLI is not available

  Scenario: Fails with clear error when no MOC files are discovered
    Given a valid vault directory with .2b/ structure
    And no top-level directories contain files with "type: moc" frontmatter
    When the user runs "2bd query 'any question'"
    Then the exit code is non-zero
    And stderr contains a message indicating no MOC files were found

  Scenario: Validation errors prevent the claude subprocess from being spawned
    Given the working directory has no ".2b/" directory
    When the user runs "2bd query 'any question'"
    Then the exit code is non-zero
    And no "claude" subprocess was started
```

## Acceptance Criteria

- [ ] Top-level `query` command registered in `cli.ts` with `<question>` argument and `--file-back <path>` option
- [ ] Validation checks `.2b/` existence, `claude` CLI on PATH, and at least one MOC file — each with a distinct stderr error message
- [ ] No subprocess spawned when validation fails
- [ ] Prompt embeds all discovered MOC content and the user's query
- [ ] System prompt instructs Claude on wikilink citation format (no `.md` extension) and clean markdown output
- [ ] Tool list is `Read,Glob,Grep` by default; `Read,Glob,Grep,Write,Edit` when `--file-back` is specified
- [ ] `claude -p` subprocess runs with cwd set to vault root
- [ ] Stdout output is raw markdown with no decorative content — pipe-friendly
- [ ] `--file-back` causes Claude to write the result as a vault note with YAML frontmatter (title, type, tags, created, updated)
- [ ] Non-zero subprocess exit code is propagated to the CLI exit code
- [ ] Unit tests cover prompt assembly, argument parsing, tool list construction, and validation logic
- [ ] Integration tests verify structural properties (exit code, file existence, frontmatter validity, wikilink pattern) not exact LLM content
