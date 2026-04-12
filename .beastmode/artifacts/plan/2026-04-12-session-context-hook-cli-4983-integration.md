---
phase: plan
epic-id: bm-4983
epic-slug: session-context-hook-cli-4983
epic-name: Session Context Hook CLI
artifact-type: integration
---

## New Scenarios

### Feature: context-assembly-cli

Covers user stories [1, 2, 3, 4, 5].

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

## Consolidation

No consolidation actions identified. This is a greenfield project with no existing test suite.
