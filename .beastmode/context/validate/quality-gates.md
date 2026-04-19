# Quality Gates

## Required Checks
- Full test suite (all unit + all integration tests) -- not just tests for the current feature
- Pre-existing regressions from commits between the last release and the current branch fork point MUST be caught and repaired before the feature passes validation

## Coverage Thresholds
- No coverage thresholds configured yet

## Custom Gates
None configured

## Manual Verification
- Validation repair log MUST document any pre-existing regressions found and fixed, including the offending commit hash and the restoration approach
