---
phase: plan
epic-id: session-context-hook-cli-4983
epic-slug: session-context-hook-cli-4983
feature-name: Context Assembly CLI
wave: 1
---

# Context Assembly CLI

**Design:** .beastmode/artifacts/design/2026-04-12-session-context-hook-cli-4983.md

## User Stories

1. As a developer, I want to run `bunx @bugroger/2bd-cli hooks session-start` without any prior installation, so that I can use the tool immediately in any project.

2. As a developer, I want to configure `2bd hooks session-start` as a Claude Code SessionStart hook, so that my project context is automatically injected into every Claude session.

3. As a developer, I want to organize my project context into `.2b/system/`, `.2b/concepts/`, and `.2b/instructions/` directories, so that context is loaded in a predictable order (system → concepts → instructions).

4. As a developer, I want the CLI to fail with a clear error if `.2b/` or any of its required subdirectories are missing, so that I know immediately when my project isn't configured correctly.

5. As a developer, I want each file in the output to be prefixed with its relative path as a markdown header, so that I can trace which file contributed each section of the injected context.

## What to Build

### Project Scaffolding

Set up the npm package with Bun + TypeScript. Configure `package.json` with the `@bugroger/2bd-cli` name, `bin.2bd` entry pointing to the CLI entry point, and `commander` as the sole production dependency. Configure TypeScript in strict mode, ESM-only, targeting esnext. Add vitest as the dev dependency for testing.

### CLI Entry Point

Create a CLI entry point that uses commander to register the extensible `<command> <subcommand>` pattern. Register `hooks` as a command group and `session-start` as its subcommand. The entry point delegates to the context assembly module when `hooks session-start` is invoked.

### Directory Validation Module

A module that validates the `.2b/` directory structure exists in the current working directory. It checks for the presence of `.2b/` and its three required subdirectories: `system/`, `concepts/`, `instructions/`. On any missing directory, it writes a descriptive error message to stderr and exits with a non-zero code. The error message must identify which specific directory is missing.

### Context Assembly Module

The core module that:

1. Walks each category directory in fixed order: system → concepts → instructions
2. Within each category, discovers direct child `.md` files only (no recursion, no non-markdown files)
3. Sorts discovered files alphabetically within each category
4. For each file, reads its contents and prepends a `## <relative-path>` header (e.g., `## .2b/system/persona.md`)
5. Concatenates all sections into a single markdown string
6. Wraps the result in the Claude Code hook JSON contract:
   ```json
   {
     "hookSpecificOutput": {
       "hookEventName": "SessionStart",
       "additionalContext": "<concatenated markdown>"
     }
   }
   ```
7. Writes the JSON to stdout

Empty categories are valid — they contribute no sections. If all categories are empty, the output JSON has an empty `additionalContext` string.

### Test Suite

Unit tests for the context assembly module: verify file discovery, alphabetical sorting, category ordering, markdown header prefixing, JSON output structure, non-markdown file filtering, and empty directory handling.

Integration tests: invoke the CLI binary as a subprocess against temporary `.2b/` directory structures. Assert exit codes, stdout JSON, and stderr error messages for both happy paths and error cases (missing `.2b/`, missing subdirectories).

## Integration Test Scenarios

```gherkin
@session-context-hook-cli-4983 @cli
Feature: Context assembly CLI -- assembles .2b/ markdown into hook-compatible JSON

  Background:
    Given a temporary working directory
    And the CLI entry point is available as "2bd"

  Scenario: Assembles context from all three categories in fixed order
    Given a ".2b/system/" directory containing
      | file            | content                |
      | persona.md      | You are a helpful bot. |
    And a ".2b/concepts/" directory containing
      | file            | content                     |
      | architecture.md | The system uses microservices. |
    And a ".2b/instructions/" directory containing
      | file            | content                    |
      | formatting.md   | Use markdown in responses. |
    When the developer runs "2bd hooks session-start"
    Then the exit code is 0
    And stdout is valid JSON matching the hook contract
    And the JSON "hookSpecificOutput.hookEventName" is "SessionStart"
    And the JSON "hookSpecificOutput.additionalContext" contains sections in order
      | section_header                    |
      | ## .2b/system/persona.md          |
      | ## .2b/concepts/architecture.md   |
      | ## .2b/instructions/formatting.md |
    And each section is followed by its file content

  Scenario: Sorts files alphabetically within each category
    Given a ".2b/system/" directory containing
      | file         | content   |
      | zebra.md     | Z content |
      | alpha.md     | A content |
    And a ".2b/concepts/" directory that is empty
    And a ".2b/instructions/" directory that is empty
    When the developer runs "2bd hooks session-start"
    Then the exit code is 0
    And the JSON "hookSpecificOutput.additionalContext" contains sections in order
      | section_header            |
      | ## .2b/system/alpha.md    |
      | ## .2b/system/zebra.md    |

  Scenario: Ignores non-markdown files in context directories
    Given a ".2b/system/" directory containing
      | file          | content        |
      | context.md    | Valid context. |
      | notes.txt     | Ignored text.  |
      | data.yaml     | ignored: true  |
    And a ".2b/concepts/" directory that is empty
    And a ".2b/instructions/" directory that is empty
    When the developer runs "2bd hooks session-start"
    Then the exit code is 0
    And the JSON "hookSpecificOutput.additionalContext" contains "## .2b/system/context.md"
    And the JSON "hookSpecificOutput.additionalContext" does not contain "notes.txt"
    And the JSON "hookSpecificOutput.additionalContext" does not contain "data.yaml"

  Scenario: Produces valid output when all category directories are empty
    Given a ".2b/system/" directory that is empty
    And a ".2b/concepts/" directory that is empty
    And a ".2b/instructions/" directory that is empty
    When the developer runs "2bd hooks session-start"
    Then the exit code is 0
    And stdout is valid JSON matching the hook contract
    And the JSON "hookSpecificOutput.additionalContext" is empty or whitespace

  Scenario: Each file section is prefixed with its relative path as a markdown header
    Given a ".2b/system/" directory containing
      | file         | content               |
      | persona.md   | I am the system role. |
    And a ".2b/concepts/" directory that is empty
    And a ".2b/instructions/" directory that is empty
    When the developer runs "2bd hooks session-start"
    Then the exit code is 0
    And the JSON "hookSpecificOutput.additionalContext" contains a line "## .2b/system/persona.md"
    And the line is immediately followed by "I am the system role."
```

```gherkin
@session-context-hook-cli-4983 @cli
Feature: Context assembly CLI error handling -- reports missing directories clearly

  Background:
    Given a temporary working directory
    And the CLI entry point is available as "2bd"

  Scenario: Fails with clear error when .2b/ directory is missing
    Given the working directory has no ".2b/" directory
    When the developer runs "2bd hooks session-start"
    Then the exit code is non-zero
    And stderr contains a message indicating the ".2b/" directory is missing

  Scenario Outline: Fails with clear error when a required subdirectory is missing
    Given a ".2b/" directory exists
    And the subdirectory "<missing_dir>" does not exist under ".2b/"
    And the other required subdirectories exist under ".2b/"
    When the developer runs "2bd hooks session-start"
    Then the exit code is non-zero
    And stderr contains a message indicating "<missing_dir>" is missing

    Examples:
      | missing_dir   |
      | system        |
      | concepts      |
      | instructions  |
```

## Acceptance Criteria

- [ ] `bunx @bugroger/2bd-cli hooks session-start` executes successfully when `.2b/` structure exists
- [ ] Output is valid JSON matching `{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "..." } }`
- [ ] Files are read in fixed category order: system → concepts → instructions
- [ ] Files are sorted alphabetically within each category
- [ ] Each file section is prefixed with `## .2b/<category>/<filename>` header
- [ ] Non-markdown files in category directories are ignored
- [ ] Empty category directories produce no sections (no crash)
- [ ] Missing `.2b/` directory causes non-zero exit with descriptive stderr message
- [ ] Missing required subdirectory causes non-zero exit with descriptive stderr message identifying which directory is missing
- [ ] `package.json` has correct `name`, `bin.2bd`, and `commander` dependency
- [ ] TypeScript compiles in strict mode, ESM-only
- [ ] Unit tests pass for assembly logic
- [ ] Integration tests pass for CLI invocation
