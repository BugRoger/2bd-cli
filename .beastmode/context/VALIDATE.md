# Validate Context

## Quality Gates
Validate must run the FULL test suite (not just feature-specific tests) to catch pre-existing regressions from commits between the last release and the current branch fork point. Repairs are documented in the validation repair log.

context/validate/quality-gates.md

## Validation Patterns
LLM-dependent tests use structural assertions (exit code, file existence, frontmatter validity, pattern matching) rather than exact content matching.

context/validate/validation-patterns.md
