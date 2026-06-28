# Validate-Dirs / Assemble-Context Regression Repair (2026-06-28)

## Incident

Two production files had been narrowed back to `system`-only between the
v0.3.0 release and this epic's branch fork:

- `src/lib/validate-dirs.ts` — commit `76cb68c` ("Relax vault validation to
  only require .2b/system/ subdirectory") shrank `REQUIRED_SUBDIRS` to
  `["system"]`.
- `src/lib/assemble-context.ts` — `CATEGORIES` was narrowed to `["system"]`,
  also dropping the `concepts`/`instructions` content from assembled output.

Released test fixtures still encoded the v0.3.0 contract
(`system`, `concepts`, `instructions`). 9 tests across 4 files failed.

## Detection

Caught by validate's full-suite run (169 tests). Failures in
`tests/unit/validate-dirs.test.ts`, `tests/unit/assemble-context.test.ts`,
`tests/integration/session-start.integration.test.ts`, and
`tests/integration/moc-discovery-and-assembly.integration.test.ts`.

## Repair

Restored `REQUIRED_SUBDIRS` and `CATEGORIES` to
`["system", "concepts", "instructions"]`, matching released v0.3.0 behavior.
No epic code was touched.

## Lesson

Second recurrence of the same class of bug documented in
[[2026-04-19-moc-regression-repair]]: pre-existing production rollbacks ride
into a feature branch through the fork point and are only caught when
validate runs the FULL test suite. Keep doing that.
