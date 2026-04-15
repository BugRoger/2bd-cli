# Runtime Date Injection -- Implementation Tasks

## Goal

Add a runtime date sentence to the beginning of the assembled context output. The sentence uses the format `Today is {DayName}, {Month} {DD}, {YYYY} at {HH}:{mm} {TZ}.` (e.g., `Today is Tuesday, April 15, 2026 at 14:35 CET.`). It appears before any `.2b/` category sections. When all categories are empty, the output contains only the date sentence.

## Architecture

- **Runtime**: Bun with TypeScript, strict mode, ESM-only, target esnext
- **Test runner**: vitest (dev dependency), run with `bunx vitest run`
- **Date formatting**: `Intl.DateTimeFormat` with hardcoded `en-US` locale and `timeZoneName: "short"` for timezone resolution
- **Formatting function**: Accepts an optional `Date` parameter for testability -- defaults to `new Date()` at call time
- **Position**: Date sentence is the first content in assembled output, separated from `.2b/` sections by a blank line
- **Locale**: Always English (`en-US`) regardless of system locale
- **Clock**: 24-hour format
- **Timezone**: System local with short abbreviation (e.g., `CET`, `EST`, `PDT`)
- **No opt-out**: The date is always injected

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/format-date.ts` | **Create.** Pure function `formatDateSentence(now?: Date): string` that formats a Date into the English date sentence using `Intl.DateTimeFormat`. |
| `src/lib/assemble-context.ts` | **Modify.** Import `formatDateSentence` and prepend its output to the assembled markdown string. Accepts an optional `now` parameter for testability. |
| `tests/unit/format-date.test.ts` | **Create.** Unit tests for `formatDateSentence` using injected Date objects. No wall-clock dependency. |
| `tests/unit/assemble-context.test.ts` | **Modify.** Update existing tests to account for the date prefix in assembled output. Pass a fixed `now` parameter to make assertions deterministic. |
| `tests/integration/runtime-date-injection.integration.test.ts` | **Create.** Integration tests from the Gherkin scenarios -- verifies date presence, format, and position via CLI subprocess. |
| `tests/integration/session-start.integration.test.ts` | **Modify.** Update two existing tests: "produces valid output when all category directories are empty" and "assembles context from all three categories in fixed order" to expect the date sentence. |

## Wave Isolation

| Wave | Tasks | Files | Parallel-safe | Reason |
|------|-------|-------|---------------|--------|
| 0 | T0 | tests/integration/runtime-date-injection.integration.test.ts | n/a | single task |
| 1 | T1 | src/lib/format-date.ts, tests/unit/format-date.test.ts | n/a | single task |
| 2 | T2, T3 | T2: src/lib/assemble-context.ts, tests/unit/assemble-context.test.ts / T3: tests/integration/session-start.integration.test.ts | no | T3 depends on T2 (integration tests invoke CLI which uses modified assemble-context.ts); sequential dispatch |
| 3 | T4 | tests/integration/runtime-date-injection.integration.test.ts | n/a | single task (GREEN verification) |

---

## Tasks

### Task 0: Integration Test (RED)

**Wave:** 0
**Depends on:** -

Write the integration test file that exercises the runtime date injection feature via the CLI as a subprocess. These tests will FAIL because the date sentence is not yet produced by the CLI. They encode the Gherkin scenarios from the feature plan.

**Files:**
- Create: `tests/integration/runtime-date-injection.integration.test.ts`

- [x] **Step 1: Create the integration test file**

Create `tests/integration/runtime-date-injection.integration.test.ts` with the following content. This file invokes the CLI entry point as a Bun subprocess and asserts the date sentence is present, correctly formatted, and positioned before file content.

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../src/cli.ts");

async function runCli(cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn("bun", ["run", CLI_PATH, "hooks", "session-start"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

async function createDotTwoBDirs(base: string): Promise<void> {
  await mkdir(join(base, ".2b"), { recursive: true });
  for (const cat of ["system", "concepts", "instructions"]) {
    await mkdir(join(base, ".2b", cat), { recursive: true });
  }
}

// Regex matching: Today is Monday, January 01, 2026 at 14:35 CET.
// Day names: Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday
// Month names: January|February|March|April|May|June|July|August|September|October|November|December
// DD: zero-padded two digits, YYYY: four digits, HH:mm: 24-hour, TZ: 1-5 uppercase letters
const DATE_SENTENCE_REGEX =
  /^Today is (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) \d{2}, \d{4} at ([01]\d|2[0-3]):\d{2} [A-Z]{1,5}\.$/;

describe("Runtime date context injection (integration)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-date-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("session context includes a date and time sentence", async () => {
    await createDotTwoBDirs(tmpDir);

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const json = JSON.parse(stdout);
    expect(json.hookSpecificOutput).toBeDefined();
    expect(json.hookSpecificOutput.hookEventName).toBe("SessionStart");

    const content: string = json.hookSpecificOutput.additionalContext;
    expect(content).toMatch(/^Today is /);
  });

  it("date sentence includes day name, full date, 24-hour time, and timezone", async () => {
    await createDotTwoBDirs(tmpDir);

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const content: string = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    const firstLine = content.split("\n")[0];

    // Day name
    expect(firstLine).toMatch(
      /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/
    );
    // Full month name
    expect(firstLine).toMatch(
      /January|February|March|April|May|June|July|August|September|October|November|December/
    );
    // Two-digit day of month
    expect(firstLine).toMatch(/\b\d{2},/);
    // Four-digit year
    expect(firstLine).toMatch(/\b\d{4}\b/);
    // 24-hour time HH:mm
    expect(firstLine).toMatch(/at ([01]\d|2[0-3]):\d{2}/);
    // Timezone abbreviation (1-5 uppercase letters before the period)
    expect(firstLine).toMatch(/[A-Z]{1,5}\.$/);

    // Full format match
    expect(firstLine).toMatch(DATE_SENTENCE_REGEX);
  });

  it("date sentence appears before any file content in the assembled context", async () => {
    await createDotTwoBDirs(tmpDir);
    await writeFile(join(tmpDir, ".2b/system/persona.md"), "You are a helpful bot.");

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const content: string = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    expect(content).toMatch(/^Today is /);

    const dateIdx = content.indexOf("Today is");
    const headerIdx = content.indexOf("## .2b/system/persona.md");

    expect(dateIdx).toBe(0);
    expect(headerIdx).toBeGreaterThan(dateIdx);
  });

  it("date sentence is present even when all category directories are empty", async () => {
    await createDotTwoBDirs(tmpDir);

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const content: string = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    expect(content).toMatch(/^Today is /);

    const firstLine = content.split("\n")[0];
    expect(firstLine).toMatch(DATE_SENTENCE_REGEX);
  });
});
```

- [x] **Step 2: Run the integration tests to verify they fail**

Run: `bunx vitest run tests/integration/runtime-date-injection.integration.test.ts`
Expected: FAIL -- the CLI does not yet produce a date sentence, so assertions like `toMatch(/^Today is /)` will fail.

- [x] **Step 3: Commit**

```bash
git add tests/integration/runtime-date-injection.integration.test.ts
git commit -m "test(runtime-date): add integration tests for date context injection (RED)"
```

---

### Task 1: Date Formatting Module

**Wave:** 1
**Depends on:** -

A pure function that formats a `Date` object into the sentence `Today is {DayName}, {Month} {DD}, {YYYY} at {HH}:{mm} {TZ}.` using `Intl.DateTimeFormat` with hardcoded `en-US` locale. Accepts an optional `Date` parameter -- defaults to `new Date()`.

**Files:**
- Create: `src/lib/format-date.ts`
- Create: `tests/unit/format-date.test.ts`

- [x] **Step 1: Write the failing tests**

Create `tests/unit/format-date.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatDateSentence } from "../../src/lib/format-date.js";

describe("formatDateSentence", () => {
  it("formats a known date into the expected sentence", () => {
    // Tuesday, April 15, 2026 at 14:35 in UTC
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);

    // The exact output depends on the system timezone, but structure is fixed.
    // We test the structure rather than exact values since TZ varies by machine.
    expect(result).toMatch(
      /^Today is (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) \d{2}, \d{4} at ([01]\d|2[0-3]):\d{2} [A-Z]{1,5}\.$/
    );
  });

  it("starts with 'Today is'", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    expect(result.startsWith("Today is ")).toBe(true);
  });

  it("ends with a period", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    expect(result.endsWith(".")).toBe(true);
  });

  it("contains a day name", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    expect(result).toMatch(
      /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/
    );
  });

  it("contains a full month name", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    expect(result).toMatch(
      /January|February|March|April|May|June|July|August|September|October|November|December/
    );
  });

  it("contains a four-digit year", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    expect(result).toMatch(/\b\d{4}\b/);
  });

  it("contains a zero-padded two-digit day", () => {
    // Use a date with a single-digit day to verify zero-padding
    const date = new Date("2026-01-05T10:00:00Z");
    const result = formatDateSentence(date);
    // The day should be zero-padded (e.g., "05" not "5")
    expect(result).toMatch(/\b\d{2},/);
  });

  it("contains 24-hour time in HH:mm format", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    expect(result).toMatch(/at ([01]\d|2[0-3]):\d{2}/);
  });

  it("contains a timezone abbreviation", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    // Timezone abbreviation: 1-5 uppercase letters before the trailing period
    expect(result).toMatch(/[A-Z]{1,5}\.$/);
  });

  it("uses en-US locale (English day and month names)", () => {
    // Wednesday, July 04, 2029
    const date = new Date("2029-07-04T12:00:00Z");
    const result = formatDateSentence(date);
    expect(result).toMatch(/July/);
    // Verify it does NOT contain non-English month names
    expect(result).not.toMatch(/Juli|Julio|Juillet/);
  });

  it("defaults to current date when no argument is provided", () => {
    const result = formatDateSentence();
    // Just verify it matches the format -- we cannot know the exact date
    expect(result).toMatch(
      /^Today is (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) \d{2}, \d{4} at ([01]\d|2[0-3]):\d{2} [A-Z]{1,5}\.$/
    );
  });

  it("returns a single-line string with no newlines", () => {
    const date = new Date("2026-04-15T14:35:00Z");
    const result = formatDateSentence(date);
    expect(result).not.toContain("\n");
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/unit/format-date.test.ts`
Expected: FAIL with "Cannot find module" or "Module not found" because `src/lib/format-date.ts` does not exist yet.

- [x] **Step 3: Write minimal implementation**

Create `src/lib/format-date.ts`:

```typescript
export function formatDateSentence(now?: Date): string {
  const date = now ?? new Date();

  const dayNameFormatter = new Intl.DateTimeFormat("en-US", { weekday: "long" });
  const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long" });
  const yearFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric" });
  const dayFormatter = new Intl.DateTimeFormat("en-US", { day: "2-digit" });
  const hourFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
  });
  const minuteFormatter = new Intl.DateTimeFormat("en-US", {
    minute: "2-digit",
  });
  const tzFormatter = new Intl.DateTimeFormat("en-US", {
    timeZoneName: "short",
  });

  const dayName = dayNameFormatter.format(date);
  const month = monthFormatter.format(date);
  const day = dayFormatter.format(date);
  const year = yearFormatter.format(date);

  const hourRaw = hourFormatter.format(date);
  // Intl may return "24" for midnight in some engines; normalize to "00"
  const hour = hourRaw === "24" ? "00" : hourRaw.padStart(2, "0");

  const minuteRaw = minuteFormatter.format(date);
  const minute = minuteRaw.padStart(2, "0");

  // Extract timezone abbreviation from a formatted string like "4/15/2026, CET"
  const tzParts = tzFormatter.formatToParts(date);
  const tzAbbr = tzParts.find((p) => p.type === "timeZoneName")?.value ?? "UTC";

  return `Today is ${dayName}, ${month} ${day}, ${year} at ${hour}:${minute} ${tzAbbr}.`;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/unit/format-date.test.ts`
Expected: All 12 tests PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/format-date.ts tests/unit/format-date.test.ts
git commit -m "feat(runtime-date): add date formatting module with tests"
```

---

### Task 2: Integrate Date Sentence into Context Assembly

**Wave:** 2
**Depends on:** Task 1

Modify `assembleContext` to prepend the date sentence to the assembled output. The function gains an optional `now?: Date` parameter for testability. Update the existing unit tests to account for the date prefix.

**Files:**
- Modify: `src/lib/assemble-context.ts`
- Modify: `tests/unit/assemble-context.test.ts`

- [x] **Step 1: Update the assemble-context unit tests**

Replace the entire contents of `tests/unit/assemble-context.test.ts` with the following. All tests now pass a fixed `now` Date so assertions are deterministic. Tests that check content positioning account for the date sentence appearing first.

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleContext } from "../../src/lib/assemble-context.js";

// Fixed date for deterministic tests: Tuesday, April 15, 2026 14:35 UTC
const FIXED_NOW = new Date("2026-04-15T14:35:00Z");

describe("assembleContext", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-assemble-"));
    await mkdir(join(tmpDir, ".2b", "system"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "concepts"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "instructions"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("begins with a date sentence matching the expected format", async () => {
    const result = await assembleContext(tmpDir, FIXED_NOW);
    expect(result).toMatch(
      /^Today is (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) \d{2}, \d{4} at ([01]\d|2[0-3]):\d{2} [A-Z]{1,5}\./
    );
  });

  it("assembles files from all three categories in fixed order", async () => {
    await writeFile(join(tmpDir, ".2b/system/persona.md"), "System content.");
    await writeFile(join(tmpDir, ".2b/concepts/arch.md"), "Concepts content.");
    await writeFile(join(tmpDir, ".2b/instructions/rules.md"), "Instructions content.");

    const result = await assembleContext(tmpDir, FIXED_NOW);

    const systemIdx = result.indexOf("## .2b/system/persona.md");
    const conceptsIdx = result.indexOf("## .2b/concepts/arch.md");
    const instructionsIdx = result.indexOf("## .2b/instructions/rules.md");

    expect(systemIdx).toBeGreaterThanOrEqual(0);
    expect(conceptsIdx).toBeGreaterThan(systemIdx);
    expect(instructionsIdx).toBeGreaterThan(conceptsIdx);
  });

  it("date sentence precedes all .2b/ category sections", async () => {
    await writeFile(join(tmpDir, ".2b/system/persona.md"), "System content.");
    await writeFile(join(tmpDir, ".2b/concepts/arch.md"), "Concepts content.");
    await writeFile(join(tmpDir, ".2b/instructions/rules.md"), "Instructions content.");

    const result = await assembleContext(tmpDir, FIXED_NOW);

    const dateIdx = result.indexOf("Today is");
    const systemIdx = result.indexOf("## .2b/system/persona.md");

    expect(dateIdx).toBe(0);
    expect(systemIdx).toBeGreaterThan(dateIdx);
  });

  it("sorts files alphabetically within a category", async () => {
    await writeFile(join(tmpDir, ".2b/system/zebra.md"), "Z");
    await writeFile(join(tmpDir, ".2b/system/alpha.md"), "A");
    await writeFile(join(tmpDir, ".2b/system/middle.md"), "M");

    const result = await assembleContext(tmpDir, FIXED_NOW);

    const alphaIdx = result.indexOf("## .2b/system/alpha.md");
    const middleIdx = result.indexOf("## .2b/system/middle.md");
    const zebraIdx = result.indexOf("## .2b/system/zebra.md");

    expect(alphaIdx).toBeLessThan(middleIdx);
    expect(middleIdx).toBeLessThan(zebraIdx);
  });

  it("prefixes each file with ## <relative-path> header", async () => {
    await writeFile(join(tmpDir, ".2b/system/persona.md"), "Content here.");

    const result = await assembleContext(tmpDir, FIXED_NOW);

    expect(result).toContain("## .2b/system/persona.md");
    const headerIdx = result.indexOf("## .2b/system/persona.md");
    const afterHeader = result.slice(headerIdx + "## .2b/system/persona.md".length).trimStart();
    expect(afterHeader.startsWith("Content here.")).toBe(true);
  });

  it("ignores non-markdown files", async () => {
    await writeFile(join(tmpDir, ".2b/system/valid.md"), "Valid.");
    await writeFile(join(tmpDir, ".2b/system/notes.txt"), "Ignored.");
    await writeFile(join(tmpDir, ".2b/system/data.yaml"), "ignored: true");

    const result = await assembleContext(tmpDir, FIXED_NOW);

    expect(result).toContain("## .2b/system/valid.md");
    expect(result).not.toContain("notes.txt");
    expect(result).not.toContain("data.yaml");
  });

  it("returns only the date sentence when all categories are empty", async () => {
    const result = await assembleContext(tmpDir, FIXED_NOW);
    expect(result).toMatch(/^Today is /);
    // No .2b/ headers should be present
    expect(result).not.toContain("## .2b/");
    // The result should be a single line (the date sentence)
    const lines = result.split("\n").filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(1);
  });

  it("handles mixed empty and non-empty categories", async () => {
    await writeFile(join(tmpDir, ".2b/concepts/design.md"), "Design notes.");

    const result = await assembleContext(tmpDir, FIXED_NOW);

    expect(result).toContain("## .2b/concepts/design.md");
    expect(result).toContain("Design notes.");
    expect(result).not.toContain("## .2b/system/");
    expect(result).not.toContain("## .2b/instructions/");
  });

  it("includes full file content after each header", async () => {
    const multiLine = "Line one.\nLine two.\nLine three.";
    await writeFile(join(tmpDir, ".2b/system/multi.md"), multiLine);

    const result = await assembleContext(tmpDir, FIXED_NOW);

    expect(result).toContain("Line one.\nLine two.\nLine three.");
  });

  it("separates date sentence from file sections with a blank line", async () => {
    await writeFile(join(tmpDir, ".2b/system/persona.md"), "Content.");

    const result = await assembleContext(tmpDir, FIXED_NOW);

    // The date sentence should be followed by \n\n before the first ## header
    const dateLineEnd = result.indexOf("\n");
    const afterDate = result.slice(dateLineEnd);
    expect(afterDate.startsWith("\n\n## .2b/")).toBe(true);
  });
});
```

- [x] **Step 2: Run updated tests to verify they fail**

Run: `bunx vitest run tests/unit/assemble-context.test.ts`
Expected: FAIL -- `assembleContext` does not yet accept a `now` parameter and does not prepend a date sentence. Tests like "begins with a date sentence" and "returns only the date sentence when all categories are empty" will fail.

- [x] **Step 3: Modify assembleContext to prepend the date sentence**

Replace the entire contents of `src/lib/assemble-context.ts` with:

```typescript
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatDateSentence } from "./format-date.js";

const CATEGORIES = ["system", "concepts", "instructions"] as const;

export async function assembleContext(basePath: string, now?: Date): Promise<string> {
  const dateSentence = formatDateSentence(now);
  const sections: string[] = [];

  for (const category of CATEGORIES) {
    const categoryDir = join(basePath, ".2b", category);
    const entries = await readdir(categoryDir);

    const mdFiles = entries
      .filter((entry) => entry.endsWith(".md"))
      .sort();

    for (const file of mdFiles) {
      const filePath = join(categoryDir, file);
      const content = await readFile(filePath, "utf-8");
      const relativePath = `.2b/${category}/${file}`;
      sections.push(`## ${relativePath}\n\n${content}`);
    }
  }

  if (sections.length === 0) {
    return dateSentence;
  }

  return dateSentence + "\n\n" + sections.join("\n\n");
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/unit/assemble-context.test.ts`
Expected: All 10 tests PASS.

- [x] **Step 5: Run all unit tests to verify no regressions**

Run: `bunx vitest run tests/unit/`
Expected: All unit tests PASS (format-date: 12, assemble-context: 10, hook-output: 4, validate-dirs: 5 = 31 total).

- [x] **Step 6: Commit**

```bash
git add src/lib/assemble-context.ts tests/unit/assemble-context.test.ts
git commit -m "feat(runtime-date): integrate date sentence into context assembly"
```

---

### Task 3: Update Existing Integration Tests

**Wave:** 2
**Depends on:** Task 2

Update the existing integration tests in `session-start.integration.test.ts` to account for the date sentence now appearing at the top of the assembled context. Two tests need changes: "produces valid output when all category directories are empty" and "assembles context from all three categories in fixed order".

**Files:**
- Modify: `tests/integration/session-start.integration.test.ts`

- [x] **Step 1: Update the "produces valid output when all category directories are empty" test**

In `tests/integration/session-start.integration.test.ts`, find the test at approximately lines 113-123:

```typescript
  it("produces valid output when all category directories are empty", async () => {
    await createDotTwoBDirs(tmpDir);

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const json = JSON.parse(stdout);
    expect(json.hookSpecificOutput).toBeDefined();
    expect(json.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(json.hookSpecificOutput.additionalContext.trim()).toBe("");
  });
```

Replace it with:

```typescript
  it("produces valid output when all category directories are empty", async () => {
    await createDotTwoBDirs(tmpDir);

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const json = JSON.parse(stdout);
    expect(json.hookSpecificOutput).toBeDefined();
    expect(json.hookSpecificOutput.hookEventName).toBe("SessionStart");

    const content: string = json.hookSpecificOutput.additionalContext;
    // With date injection, empty categories still produce the date sentence
    expect(content).toMatch(/^Today is /);
    // No .2b/ headers should be present
    expect(content).not.toContain("## .2b/");
  });
```

- [x] **Step 2: Update the "assembles context from all three categories in fixed order" test**

In `tests/integration/session-start.integration.test.ts`, find the test at approximately lines 55-79. After the existing assertions about category order, add an assertion that the date sentence precedes all category sections. Find:

```typescript
    expect(content).toContain("You are a helpful bot.");
    expect(content).toContain("The system uses microservices.");
    expect(content).toContain("Use markdown in responses.");
  });
```

Replace it with:

```typescript
    expect(content).toContain("You are a helpful bot.");
    expect(content).toContain("The system uses microservices.");
    expect(content).toContain("Use markdown in responses.");

    // Date sentence precedes all .2b/ section headers
    expect(content).toMatch(/^Today is /);
    const dateIdx = content.indexOf("Today is");
    expect(dateIdx).toBe(0);
    expect(systemIdx).toBeGreaterThan(dateIdx);
  });
```

- [x] **Step 3: Run the updated existing integration tests**

Run: `bunx vitest run tests/integration/session-start.integration.test.ts`
Expected: All 9 tests PASS. The two updated tests now expect the date sentence.

- [x] **Step 4: Commit**

```bash
git add tests/integration/session-start.integration.test.ts
git commit -m "test(runtime-date): update existing integration tests for date prefix"
```

---

### Task 4: Integration Tests GREEN

**Wave:** 3
**Depends on:** Task 0, Task 2, Task 3

Run the integration tests written in Task 0. They should now pass because the date sentence is produced by the CLI. Also run the full test suite to verify no regressions.

**Files:**
- (No file changes expected -- this is a verification task)

- [x] **Step 1: Run the date injection integration tests**

Run: `bunx vitest run tests/integration/runtime-date-injection.integration.test.ts`
Expected: All 4 integration tests PASS.

- [x] **Step 2: Run all integration tests together**

Run: `bunx vitest run tests/integration/`
Expected: All 13 integration tests PASS (9 existing + 4 new).

- [x] **Step 3: Run the full test suite**

Run: `bunx vitest run`
Expected: All tests PASS (31 unit + 13 integration = 44 total).

- [x] **Step 4: Commit (only if adjustments were needed)**

```bash
git add -A
git commit -m "test(runtime-date): integration tests GREEN"
```

---

## Acceptance Criteria Traceability

| Acceptance Criterion | Task(s) |
|---|---|
| `assembleContext()` output begins with `Today is {DayName}, {Month} {DD}, {YYYY} at {HH}:{mm} {TZ}.` | T1, T2, T4 |
| Date sentence uses hardcoded `en-US` locale with 24-hour clock | T1 |
| Timezone is system local with short abbreviation (e.g. `CET`, `EST`, `PDT`) | T1 |
| Date sentence precedes all `.2b/` category sections in assembled output | T2, T3, T4 |
| When all categories are empty, output contains only the date sentence | T2, T3, T4 |
| Date formatting function accepts optional `Date` parameter for testability | T1 |
| Unit tests pass with injected `Date` objects -- no wall-clock dependency | T1, T2 |
| Existing integration tests updated to account for date prefix | T3 |
| New integration tests verify date presence, format, and position | T0, T4 |
