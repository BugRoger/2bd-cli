# Tech Stack

## Core Stack
- Runtime: Bun
- Language: TypeScript (strict mode, ESM-only, target esnext)
- CLI framework: commander

## Key Dependencies
- Production: commander (^13.1.0), yaml (^2.x -- YAML frontmatter parsing for MOC discovery)
- Dev: vitest (^3.1.1), typescript (^5.8.3), @types/bun (^1.2.9)

## Development Tools
- Test runner: `bunx vitest run`
- Type check: `bunx tsc --noEmit`
- Package manager: bun

## Commands
- `bun run test` -- run full test suite
- `bun run test:watch` -- run tests in watch mode
- `bun run src/cli.ts hooks session-start` -- run CLI locally
