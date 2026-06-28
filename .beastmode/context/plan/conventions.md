# Conventions

## Naming
[Populated by init or retro]

## Code Style
- Locale-sensitive formatting: always use `Intl.DateTimeFormat` with hardcoded `en-US` locale -- never rely on `toLocaleString()` or system locale
- Timezone abbreviations may be offset-style (e.g., `GMT+2`, `UTC-5`) not just letter abbreviations (e.g., `CET`, `EST`) -- regex patterns must handle both forms

## Patterns
- Optional parameter injection for testability: functions depending on runtime values (time, environment) accept optional parameters with sensible defaults (e.g., `now?: Date`)
- Assembled context output order: runtime-injected values first, then `.2b/` file content, then MOC file content
- YAML frontmatter convention: files using YAML frontmatter delimited by `---` fences are parsed with the `yaml` package; the `type` field is used for file classification (e.g., `type: moc`)
- Pure discovery functions: new content sources (like MOC files) are implemented as standalone async functions (`discoverMocs(basePath)`) returning typed records, then integrated into `assembleContext` -- keeps discovery logic testable in isolation
- Recursive directory walking with symlink safety: use `lstat` to detect and skip symbolic links before recursing into subdirectories
- Env-var namespace: 2bd-owned process env vars use the `TWOBD_` prefix (e.g. `TWOBD_HOOK_DISABLED`). Sentinel-style toggles use the value `"1"` for "on" and absence-or-anything-else for "off"; the hook check is `process.env.TWOBD_X === "1"`.
- Atomic file writes: any module writing under `.2b/state/` uses the shared `atomicWriteFile` primitive — write to a temp file in the same directory, then rename. Same-directory temp keeps rename atomic on POSIX. No flock; concurrent writers on the same target accept last-write-wins with at most one block lost, never a partially written file.
- Hook subcommand placement: new Claude Code hooks register under the existing `hooks` commander group as `2bd hooks <event-name>` (kebab-case event name matching the Claude Code event), with the action exported from `src/hooks/<event-name>.ts`.

## Anti-Patterns
[Populated by init or retro]
