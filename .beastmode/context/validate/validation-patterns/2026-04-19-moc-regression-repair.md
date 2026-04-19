# MOC Regression Repair (2026-04-19)

## Incident

Commit `9d0e3a9` ("Remove MOC discovery from context assembly") shipped between v0.3.0 release and the vault-query-command feature branch fork point. It stripped MOC discovery and narrowed CATEGORIES to system-only in `src/lib/assemble-context.ts`, breaking 15 tests across 3 test files. The commit was a beastmode state cleanup that accidentally included production code rollback.

## Detection

Caught by the validate phase's full test suite run (110 tests). 15 test failures in assemble-context, moc-discovery-and-assembly, and session-start test files.

## Repair

Restored `CATEGORIES` to `["system", "concepts", "instructions"]` and re-added the `discoverMocs` call in `assembleContext`, matching released v0.3.0 behavior.

## Lesson

Beastmode state management commits can inadvertently include production code changes. The validate phase must always run the FULL test suite, not just tests for the current feature. Pre-existing regressions from commits between the last release and the current branch fork point are in the blast radius.
