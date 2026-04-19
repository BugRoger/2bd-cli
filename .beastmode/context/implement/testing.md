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
- Dependency injection for external tool checks -- functions that validate external CLI availability accept an optional `whichFn` parameter; tests pass a stub returning null to simulate missing tools without modifying the real PATH
- LLM-dependent integration tests verify structural properties (exit code, file existence, YAML frontmatter validity, wikilink pattern presence) not exact content, because LLM output is non-deterministic
- LLM integration tests require extended timeout (120s) due to subprocess spawning and API calls

## Coverage
- 110 tests total: 72 unit + 38 integration (10 test files)
- No coverage thresholds configured yet
