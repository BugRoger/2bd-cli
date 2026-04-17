---
phase: plan
artifact: integration
epic-id: bm-0ccc
epic-slug: moc-context-assembly-0ccc
epic-name: MOC Context Assembly
date: 2026-04-17
---

# Integration Test Artifact: MOC Context Assembly

## New Scenarios

### Feature: moc-discovery-and-assembly

Covers user stories [1, 2, 3].

```gherkin
@moc-context-assembly-0ccc @context-assembly
Feature: MOC file discovery and context assembly -- MOC files from numbered Obsidian vault folders are discovered, processed, and included in session context

  Background:
    Given a workspace with a valid .2b/ category structure
    And the .2b/system/ directory contains a markdown file with system content
    And the .2b/concepts/ directory contains a markdown file with concepts content

  Scenario: MOC files from numbered top-level folders are included in session context
    Given a top-level directory named "10 Projects" exists in the workspace
    And "10 Projects" contains a markdown file with "type: moc" YAML frontmatter
    When the session-start hook runs
    Then the session context includes the content of the MOC file
    And the MOC file content appears with a relative path header

  Scenario: MOC files appear after .2b/ category content in the assembled context
    Given a top-level directory named "10 Projects" exists in the workspace
    And "10 Projects" contains a markdown file with "type: moc" YAML frontmatter
    When the session-start hook runs
    Then the date sentence appears first in the assembled context
    And the .2b/ category content appears after the date sentence
    And the MOC file content appears after all .2b/ category content

  Scenario: YAML frontmatter is stripped from MOC file content
    Given a top-level directory named "20 Areas" exists in the workspace
    And "20 Areas" contains a markdown file with "type: moc" YAML frontmatter and body content
    When the session-start hook runs
    Then the MOC file content in the session context does not contain YAML frontmatter delimiters
    And the MOC file body content is present in the session context

  Scenario: MOC files from nested subdirectories are discovered
    Given a top-level directory named "10 Projects" exists in the workspace
    And "10 Projects" contains a nested subdirectory with a markdown file with "type: moc" YAML frontmatter
    When the session-start hook runs
    Then the session context includes the content of the nested MOC file
    And the nested MOC file content appears with its full relative path as a header

  Scenario: Markdown files without "type: moc" frontmatter are excluded
    Given a top-level directory named "10 Projects" exists in the workspace
    And "10 Projects" contains a markdown file without "type: moc" YAML frontmatter
    When the session-start hook runs
    Then the session context does not include the non-MOC markdown file

  Scenario: MOC files are sorted by numeric prefix on their full relative path
    Given a top-level directory named "10 Projects" exists with a MOC file
    And a top-level directory named "30 Resources" exists with a MOC file
    And a top-level directory named "20 Areas" exists with a MOC file
    When the session-start hook runs
    Then the MOC file from "10 Projects" appears before the MOC file from "20 Areas"
    And the MOC file from "20 Areas" appears before the MOC file from "30 Resources"

  Scenario Outline: Only directories matching the numbered prefix pattern are scanned
    Given a top-level directory named "<dirname>" exists in the workspace
    And "<dirname>" contains a markdown file with "type: moc" YAML frontmatter
    When the session-start hook runs
    Then the session context <inclusion> the MOC file from "<dirname>"

    Examples:
      | dirname        | inclusion        |
      | 10 Projects    | includes         |
      | 00 Inbox       | includes         |
      | 99 Archive     | includes         |
      | Projects       | does not include |
      | my-notes       | does not include |
      | 1 Single Digit | does not include |
```

```gherkin
@moc-context-assembly-0ccc @backwards-compat
Feature: Backwards compatibility without MOC sources -- Session-start hook produces unchanged output when no numbered folders or MOC files exist

  Scenario: Workspace without numbered folders produces identical output to pre-feature behavior
    Given a workspace with a valid .2b/ category structure
    And the .2b/ categories contain markdown files
    And no top-level directories match the numbered prefix pattern
    When the session-start hook runs
    Then the session context contains the date sentence followed by .2b/ category content
    And the session context does not contain any MOC file sections
    And the hook exits successfully with no errors or warnings

  Scenario: Numbered folders exist but contain no MOC files
    Given a workspace with a valid .2b/ category structure
    And the .2b/ categories contain markdown files
    And a top-level directory named "10 Projects" exists with only non-MOC markdown files
    When the session-start hook runs
    Then the session context contains the date sentence followed by .2b/ category content
    And the session context does not contain any MOC file sections
    And the hook exits successfully with no errors or warnings

  Scenario: Empty numbered folders produce no MOC section and no errors
    Given a workspace with a valid .2b/ category structure
    And the .2b/ categories contain markdown files
    And a top-level directory named "10 Projects" exists but is empty
    When the session-start hook runs
    Then the session context contains the date sentence followed by .2b/ category content
    And the session context does not contain any MOC file sections
    And the hook exits successfully with no errors or warnings
```

## Consolidation

No consolidation actions identified. The existing integration test suite covers `.2b/` category assembly, date injection, and directory validation -- none of which overlap with or are superseded by the MOC discovery behavior introduced by this epic. All existing scenarios remain valid and complementary to the new scenarios above.
