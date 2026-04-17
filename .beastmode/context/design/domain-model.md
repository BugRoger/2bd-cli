# Domain Model

## Core Entities
- **Category**: Fixed subdirectory under `.2b/` (system, concepts, instructions) containing markdown files
- **MocRecord**: A discovered MOC file represented as `{ relativePath: string, body: string }` -- relative path from workspace root and body content with frontmatter stripped
- **Hook Output**: JSON envelope wrapping assembled markdown context for Claude Code's session-start hook contract

## Relationships
- `assembleContext` produces sections from Categories first, then from MocRecords
- MocRecords are produced by `discoverMocs` which scans numbered top-level directories

## Business Rules
- Only directories matching `/^\d{2} /` (two digits followed by a space) are scanned for MOC files
- Only `.md` files with `type: moc` in YAML frontmatter qualify as MOC files
- YAML frontmatter is always stripped before inclusion -- only body content is emitted
- MOC files are sorted by full relative path using natural/numeric collation
- Symbolic links are never followed during MOC directory traversal

## Ubiquitous Language
- **MOC (Map of Content)**: An Obsidian convention -- a markdown file that acts as a structural index for a knowledge area, identified by `type: moc` in its YAML frontmatter
- **Numbered directory**: A top-level directory whose name starts with two digits and a space (e.g., "10 Projects", "20 Areas") -- the Obsidian numbering convention for knowledge organization
- **Frontmatter**: YAML metadata block delimited by `---` fences at the top of a markdown file
