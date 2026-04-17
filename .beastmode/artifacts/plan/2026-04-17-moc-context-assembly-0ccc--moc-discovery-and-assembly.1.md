---
phase: plan
epic-id: moc-context-assembly-0ccc
epic-slug: moc-context-assembly-0ccc
feature-name: MOC Discovery and Assembly
wave: 1
---

# MOC Discovery and Assembly

**Design:** `.beastmode/artifacts/design/2026-04-17-moc-context-assembly-0ccc.md`

## User Stories

1. As a user with an Obsidian vault, I want MOC files to be automatically discovered and included in my Claude Code session context, so that the LLM has structural awareness of my knowledge base without manual intervention.

2. As a user, I want MOC file content to appear with relative path headers and stripped frontmatter after my `.2b/` category content, so that the assembled context is clean and predictably ordered.

3. As a user without any numbered top-level folders or MOC files, I want the session-start hook to behave exactly as before with no errors or warnings, so that the feature is backwards-compatible.

## What to Build

**New production dependency:** Add `yaml` package for YAML frontmatter parsing.

**New module — MOC discovery:** A pure async function that accepts a base path and returns an ordered list of MOC file records (relative path + body content with frontmatter stripped). The module:

1. Reads top-level entries of the base path and filters to directories matching the `/^\d{2} /` regex pattern (two digits followed by a space).
2. Recursively walks each matched directory to unlimited depth, collecting all `.md` files. Skips symbolic links during traversal to avoid circular references.
3. For each collected markdown file, reads its content and attempts to parse YAML frontmatter (delimited by `---` fences). If the frontmatter contains `type: moc`, the file qualifies. Files without frontmatter, without a `type` field, or with `type` set to anything other than `moc` are excluded.
4. For qualifying files, strips the YAML frontmatter and retains only the body content.
5. Sorts qualified MOC records by their full relative path using natural/numeric sort — the numeric prefix on directory names determines order (e.g., `10 Projects/foo.md` before `20 Areas/bar.md`).
6. Returns the sorted list. Returns an empty array if no matching directories or MOC files are found.

**Integration into assembly pipeline:** The existing `assembleContext` function is extended to call the MOC discovery module after the `.2b/` category loop. For each returned MOC record, a section is created with a `## relative/path/to/file.md` header followed by the stripped body content. These sections are appended after all `.2b/` category sections in the final output. If no MOC records are returned, the output is unchanged — no empty headers, no warnings.

**Unit tests for MOC discovery module:**
- Temp directory with numbered folders containing MOC files
- Files with and without `type: moc` frontmatter (various `type` values)
- Missing frontmatter entirely
- Nested subdirectory discovery
- Symlink skipping
- Numeric prefix sorting across multiple folders and depths
- Non-matching directory names excluded (no digits, single digit, no space after digits)
- Empty matched directories produce empty result

**Unit tests for assembly pipeline extension:**
- MOC content appears after `.2b/` content
- Frontmatter stripped from output
- Empty MOC result leaves output unchanged

**Integration tests:** Implement the 10 Gherkin scenarios from the integration artifact as Vitest integration tests following the existing `runCli` + temp directory pattern.

## Integration Test Scenarios

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

## Acceptance Criteria

- [ ] `yaml` package added as a production dependency
- [ ] MOC discovery module recursively scans top-level directories matching `/^\d{2} /` for `.md` files with `type: moc` YAML frontmatter
- [ ] Symbolic links are skipped during recursive directory traversal
- [ ] YAML frontmatter is stripped from MOC file content before inclusion in output
- [ ] MOC file sections use `## relative/path/to/file.md` headers consistent with `.2b/` file headers
- [ ] MOC files are sorted by numeric prefix on their full relative path (natural sort)
- [ ] MOC content appears after all `.2b/` category content in assembled output
- [ ] When no numbered directories or MOC files exist, output is identical to pre-feature behavior with no errors or warnings
