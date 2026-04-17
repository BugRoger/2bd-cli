---
phase: design
epic-id: bm-0ccc
epic-slug: sharded-zilch-0ccc
epic-name: MOC Context Assembly
---

## Problem Statement

Claude Code session context currently only includes files from the fixed `.2b/{system,concepts,instructions}/` category structure. Users with Obsidian-style vaults have Maps of Content (MOC) files scattered across numbered top-level folders that contain high-value structural context. These MOC files are invisible to the session-start hook, forcing users to manually include this context.

## Solution

Extend the session-start hook's context assembly to recursively scan top-level directories matching the `/^\d{2} /` pattern for markdown files with `type: moc` YAML frontmatter. Discovered MOC file contents (frontmatter stripped) are appended after the existing `.2b/` category output, sorted by numeric prefix on their full relative path.

## User Stories

1. As a user with an Obsidian vault, I want MOC files to be automatically discovered and included in my Claude Code session context, so that the LLM has structural awareness of my knowledge base without manual intervention.

2. As a user, I want MOC file content to appear with relative path headers and stripped frontmatter after my `.2b/` category content, so that the assembled context is clean and predictably ordered.

3. As a user without any numbered top-level folders or MOC files, I want the session-start hook to behave exactly as before with no errors or warnings, so that the feature is backwards-compatible.

## Implementation Decisions

- Add `yaml` as a production dependency for proper YAML frontmatter parsing
- Scan only top-level directories matching `/^\d{2} /` pattern (e.g. "00 Inbox", "10 Capture", "23 Resource")
- Recurse into matched directories with unlimited depth
- Skip symbolic links during recursive scan to avoid circular references
- Identify MOC files by parsing YAML frontmatter and checking for `type: moc`
- Strip YAML frontmatter from MOC file content before including in output
- Leave wikilinks (`[[Some Page]]`) as-is in the output — they are informational for the LLM
- Format each MOC file with a `## relative/path/to/file.md` header, consistent with existing `.2b/` file headers
- Sort MOC files by numeric prefix on full relative path (natural sort respecting folder numbering)
- MOC content appears after `.2b/` category content in the assembled output (date sentence -> .2b/ categories -> MOC files)
- If no matching directories or MOC files are found, silently produce no MOC section — existing output is unaffected

## Testing Decisions

- Unit tests for new MOC discovery module: temp directories with numbered folders, `.md` files with and without `type: moc` frontmatter, symlinks to skip, nested structures
- Unit tests for frontmatter parsing: valid YAML, missing frontmatter, `type` field with different values, quoted values
- Unit tests for numeric prefix sorting across multiple folders and depths
- Integration tests: CLI subprocess with an Obsidian-style vault structure alongside `.2b/` directory, verifying output order and content
- Integration test for empty case: no numbered folders, confirming unchanged output
- Follow existing patterns: real temp directories (no fs mocking), `mkdtemp` with cleanup, direct assertion over snapshots

## Out of Scope

- Loading child files referenced by wikilinks in MOC content
- Configuration file for customizing scan directories or patterns
- Support for non-markdown MOC formats
- Recursive MOC-to-MOC reference following
- Any modification to the `.2b/` category discovery mechanism

## Further Notes

None

## Deferred Ideas

- Configurable scan root patterns (beyond the `\d{2} ` convention)
- Wikilink resolution and child file loading
- MOC-aware content deduplication (if the same file is referenced by multiple MOCs)
