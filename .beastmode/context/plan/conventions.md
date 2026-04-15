# Conventions

## Naming
[Populated by init or retro]

## Code Style
- Locale-sensitive formatting: always use `Intl.DateTimeFormat` with hardcoded `en-US` locale -- never rely on `toLocaleString()` or system locale
- Timezone abbreviations may be offset-style (e.g., `GMT+2`, `UTC-5`) not just letter abbreviations (e.g., `CET`, `EST`) -- regex patterns must handle both forms

## Patterns
- Optional parameter injection for testability: functions depending on runtime values (time, environment) accept optional parameters with sensible defaults (e.g., `now?: Date`)
- Assembled context output order: runtime-injected values first, then `.2b/` file content

## Anti-Patterns
[Populated by init or retro]
