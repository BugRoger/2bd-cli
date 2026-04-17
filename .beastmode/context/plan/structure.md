# Structure

## Directory Layout
```
src/
  cli.ts                          # CLI entry point (commander)
  hooks/
    session-start.ts              # Per-hook orchestrator
  lib/
    validate-dirs.ts              # Pure library modules
    assemble-context.ts
    discover-mocs.ts              # MOC discovery from numbered Obsidian-style dirs
    hook-output.ts
    format-date.ts                # Date sentence formatting (Intl.DateTimeFormat)
tests/
  unit/
    validate-dirs.test.ts
    assemble-context.test.ts
    discover-mocs.test.ts
    hook-output.test.ts
    format-date.test.ts
  integration/
    session-start.integration.test.ts
    runtime-date-injection.integration.test.ts
    moc-discovery-and-assembly.integration.test.ts
```

## Key Directories
- `src/hooks/` -- one file per hook subcommand (orchestrators)
- `src/lib/` -- pure library modules (no side effects except fs reads)
- `tests/unit/` -- unit tests per library module
- `tests/integration/` -- CLI subprocess tests

## Key File Locations
- Package config: `package.json`, `tsconfig.json`
- CLI entry: `src/cli.ts`

## Where to Add New Code
- New hook type: add `src/hooks/<hook-name>.ts` orchestrator, register in `src/cli.ts`
- New library module: add to `src/lib/`, unit test in `tests/unit/`
