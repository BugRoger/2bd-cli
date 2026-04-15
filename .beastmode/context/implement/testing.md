# Testing

## Test Commands
- `bun run test` -- full suite (vitest run)
- `bun run test:watch` -- watch mode (vitest)
- `bunx vitest run tests/unit/` -- unit tests only
- `bunx vitest run tests/integration/` -- integration tests only

## Test Structure
- Unit tests: one test file per library module in tests/unit/
- Integration tests: CLI subprocess tests in tests/integration/
- All tests use temp directories (mkdtemp) with cleanup (afterEach rm)

## Conventions
- TDD: integration tests written RED first, turned GREEN last
- Direct assertion over snapshots -- output is deterministic
- Integration tests invoke CLI via Bun.spawn as subprocess
- No mocking of filesystem -- real temp directories
- Optional parameter injection for testability -- functions that depend on wall-clock time accept an optional `now?: Date` parameter defaulting to `new Date()`; tests pass a fixed Date for deterministic assertions

## Coverage
- 44 tests total: 31 unit + 13 integration
- No coverage thresholds configured yet
