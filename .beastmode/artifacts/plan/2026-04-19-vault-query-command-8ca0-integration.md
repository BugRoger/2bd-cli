---
phase: plan
artifact: integration
epic-id: bm-8ca0
epic-slug: vault-query-command-8ca0
epic-name: Vault Query Command
date: 2026-04-19
---

# Integration Test Artifact: Vault Query Command

## New Scenarios

### Feature: vault-query-command

Covers user stories [1, 2, 3, 4, 5].

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

## Consolidation

No consolidation actions identified. The existing integration test suite covers session-start hook behavior (context assembly, date injection, MOC discovery, directory validation). The `query` command is an entirely new top-level command with no behavioral overlap with the session-start hook. While both the query command and the session-start hook use MOC discovery internally, they are distinct user-facing capabilities: one produces a hook-contract JSON payload, the other spawns an agentic LLM subprocess and returns a cited summary. No existing scenarios are stale or superseded by this epic.
