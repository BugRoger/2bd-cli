---
phase: plan
epic-id: bm-f8ce
epic-slug: session-end-memory-capture-hooks-f8ce
epic-name: Session End Memory Capture Hooks
artifact-type: integration-tests
---

# Integration Test Scenarios — Session End Memory Capture Hooks

## Scope

Greenfield BDD artifact. No prior `.feature` files exist in the project. Existing integration tests are vitest-shaped (`tests/integration/*.integration.test.ts`) and drive the CLI via subprocess; the scenarios below describe behavioral intent only and leave framework choice to the implementer.

All scenarios are tagged with `@session-end-memory-capture-hooks-f8ce` (epic) plus one capability tag:

- `@capture` — per-turn Stop hook behavior (daily log append, cursor advance)
- `@finalize` — SessionEnd hook behavior (final cursor write, end marker)
- `@resilience` — silent-failure / error-policy semantics shared across both hooks
- `@isolation` — recursion guard and concurrent-session safety

## New Scenarios

### Feature: capture-pipeline

Covers user stories 1, 2, 3, 4, 5.

```gherkin
@session-end-memory-capture-hooks-f8ce @capture
Feature: capture pipeline -- per-turn assistant capture to daily JSONL log

  Background:
    Given a 2bd vault with a valid .2b/ layout
    And no prior capture state exists for today

  Scenario: a completed assistant turn is appended to today's daily log
    Given a Claude Code session has produced one user turn and one assistant turn
    When the Stop hook fires for that session
    Then today's daily log contains one entry for the user turn and one entry for the assistant turn
    And each entry records the timestamp, the session identifier, the role, and the textual content
    And the daily log file is named for today's local calendar date

  Scenario: only text content is captured; tool and reasoning blocks are dropped
    Given a Claude Code session produces an assistant turn that mixes text, tool use, tool result, and internal reasoning blocks
    When the Stop hook fires
    Then the daily log entry for that turn contains the text portion only
    And the entry does not contain tool invocation details, tool output, or internal reasoning

  Scenario: the daily log path uses the local calendar date
    Given the local calendar date is known
    When the Stop hook captures an assistant turn
    Then the daily log file path reflects today's local date in YYYY-MM-DD form
    And the file lives under the vault's hidden state area for session captures

  Scenario: the state area is created on first capture when absent
    Given the vault has no prior state directory
    When the Stop hook fires for the first time
    Then the state area for session captures is created
    And the daily log for today exists with the captured turn appended

  Scenario Outline: successive Stop invocations append only newly produced turns
    Given a session has produced <first_batch> assistant turns and the Stop hook has captured them
    When the session produces <second_batch> additional assistant turns
    And the Stop hook fires again
    Then today's daily log contains exactly <total> assistant entries for that session
    And no captured turn is duplicated

    Examples:
      | first_batch | second_batch | total |
      | 1           | 1            | 2     |
      | 3           | 2            | 5     |
      | 5           | 0            | 5     |
```

```gherkin
@session-end-memory-capture-hooks-f8ce @isolation
Feature: capture pipeline -- recursion guard and concurrency

  Scenario: Stop hook short-circuits when the recursion guard sentinel is set
    Given the recursion guard environment sentinel is set on the hook process
    When the Stop hook fires
    Then no entry is appended to today's daily log
    And no cursor record is created or updated
    And the hook reports success

  Scenario: a nested 2bd query subprocess does not pollute the parent session's daily log
    Given a Claude Code session is active with capture enabled
    When the user runs a 2bd query command from inside that session
    And the query subprocess's own assistant turns complete
    Then those subprocess turns do not appear in today's daily log
    And only the parent session's turns are captured

  Scenario: concurrent Stop invocations on the same day never produce a malformed daily log
    Given two Claude Code sessions in separate worktrees of the same vault both produce assistant turns
    When both sessions' Stop hooks fire concurrently
    Then today's daily log remains valid line-delimited JSON
    And every line in the file is a well-formed turn entry
    And at most one captured turn block may be lost, never a partially written line
```

```gherkin
@session-end-memory-capture-hooks-f8ce @capture
Feature: capture pipeline -- cursor resume across session lifecycle

  Scenario: reopening a session resumes capture from the prior cursor position
    Given a session produced two assistant turns and the Stop hook captured both
    And the session was then closed
    When the same session is reopened and produces one new assistant turn
    And the Stop hook fires
    Then today's daily log contains the two original turns and the one new turn
    And neither of the original turns is duplicated

  Scenario: an in-session compaction does not duplicate already-captured turns
    Given a session produced several assistant turns and the Stop hook captured them
    When the user triggers an in-session compaction
    And subsequent Stop invocations occur
    Then today's daily log contains each original turn exactly once
    And only genuinely new turns produced after compaction are appended

  Scenario: each tracked session has an independent cursor
    Given two distinct sessions have each produced assistant turns
    And the Stop hook has captured turns from both
    When either session produces a further turn
    And its Stop hook fires
    Then only that session's cursor advances
    And the other session's cursor is unchanged
```

```gherkin
@session-end-memory-capture-hooks-f8ce @resilience
Feature: capture pipeline -- silent failure policy

  Scenario: a missing transcript path is logged and does not break the session
    Given the Stop hook receives a payload whose transcript path does not exist on disk
    When the Stop hook runs
    Then the hook reports success to Claude Code
    And an error entry describing the missing transcript is recorded in the hook error log
    And today's daily log is not modified

  Scenario: a malformed payload is logged and does not break the session
    Given the Stop hook receives a payload that cannot be parsed
    When the Stop hook runs
    Then the hook reports success to Claude Code
    And an error entry describing the parse failure is recorded in the hook error log

  Scenario: a transcript with a malformed line is skipped without aborting capture
    Given the transcript contains a well-formed assistant turn followed by a malformed line followed by another well-formed assistant turn
    When the Stop hook fires
    Then the two well-formed turns are appended to today's daily log
    And the malformed line is skipped
    And an error entry referencing the skipped line is recorded in the hook error log
    And the hook reports success
```

### Feature: session-end-finalize

Covers shared user stories 2 and 3 (silent failure and cursor resume) as scoped to the session-end hook.

```gherkin
@session-end-memory-capture-hooks-f8ce @finalize
Feature: session-end finalize -- terminating cursor write and end marker

  Background:
    Given a 2bd vault with a valid .2b/ layout

  Scenario: SessionEnd writes a final cursor update for the terminating session
    Given a session has been actively captured during its lifetime
    When the SessionEnd hook fires for that session
    Then the cursor record for that session reflects the final transcript position
    And the cursor record's last-updated timestamp reflects the end of the session

  Scenario: SessionEnd emits a session-end marker into today's daily log
    Given a session has produced captured turns earlier today
    When the SessionEnd hook fires for that session
    Then today's daily log contains a session-end marker line referencing that session
    And the marker is appended after the last captured turn for that session

  Scenario: SessionEnd creates the state area lazily if no Stop hook ran first
    Given the vault has no prior state directory
    And no Stop hook has fired for the terminating session
    When the SessionEnd hook fires
    Then the state area for session captures is created
    And today's daily log contains a session-end marker for the terminating session
```

```gherkin
@session-end-memory-capture-hooks-f8ce @resilience
Feature: session-end finalize -- silent failure policy

  Scenario: SessionEnd errors are logged and never break the session
    Given the SessionEnd hook encounters an error while finalizing state
    When the hook runs
    Then the hook reports success to Claude Code
    And an error entry describing the failure is recorded in the hook error log
    And no partial or malformed file is left behind in the state area

  Scenario: SessionEnd with a malformed payload does not break the session
    Given the SessionEnd hook receives a payload that cannot be parsed
    When the hook runs
    Then the hook reports success to Claude Code
    And an error entry describing the parse failure is recorded in the hook error log
```

## Consolidation

No consolidation actions identified. The project has no pre-existing `.feature` files, so there are no overlapping or stale scenarios to merge, update, or remove.
