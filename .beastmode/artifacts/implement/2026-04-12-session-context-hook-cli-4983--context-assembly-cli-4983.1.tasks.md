# Context Assembly CLI -- Implementation Tasks

## Goal

Build a minimal CLI tool (`@bugroger/2bd-cli`) that walks a `.2b/` directory structure, reads markdown files organized by category (system, concepts, instructions), and outputs Claude Code hook-compatible JSON to stdout. Invoked as `2bd hooks session-start`.

## Architecture

- **Runtime**: Bun with TypeScript, strict mode, ESM-only, target esnext
- **CLI framework**: `commander` (sole production dependency) for `<command> <subcommand>` routing
- **Distribution**: npm package `@bugroger/2bd-cli` with `bin.2bd` entry
- **Testing**: `vitest` (dev dependency)
- **Directory convention**: `.2b/` with three required subdirectories: `system/`, `concepts/`, `instructions/`
- **File discovery**: Flat only (direct children), `.md` files only, alphabetical sort within each category
- **Category order**: Fixed: system -> concepts -> instructions
- **Output format**: JSON to stdout: `{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<markdown>" } }`
- **File delimiters**: `## <relative-path>` header per file (e.g., `## .2b/system/persona.md`), no category-level headers
- **Error handling**: Missing `.2b/` or required subdirectory -> stderr message + non-zero exit

## File Structure

| File | Responsibility |
|------|---------------|
| `package.json` | Package metadata, bin entry, dependencies |
| `tsconfig.json` | TypeScript strict mode, ESM, esnext config |
| `src/cli.ts` | CLI entry point -- commander setup, command registration, shebang |
| `src/hooks/session-start.ts` | Orchestrator for session-start subcommand -- validates dirs, assembles context, writes JSON to stdout |
| `src/lib/validate-dirs.ts` | Validates `.2b/` and its three required subdirectories exist |
| `src/lib/assemble-context.ts` | Discovers `.md` files, reads them, builds concatenated markdown string with headers |
| `src/lib/hook-output.ts` | Wraps assembled markdown in the Claude Code hook JSON contract |
| `tests/unit/validate-dirs.test.ts` | Unit tests for directory validation |
| `tests/unit/assemble-context.test.ts` | Unit tests for context assembly (file discovery, sorting, headers, concatenation) |
| `tests/unit/hook-output.test.ts` | Unit tests for hook JSON output structure |
| `tests/integration/session-start.integration.test.ts` | Integration tests -- invokes CLI as subprocess, asserts stdout/stderr/exit codes |

## Wave Isolation

| Wave | Tasks | Files | Parallel-safe | Reason |
|------|-------|-------|---------------|--------|
| 0 | T0 | tests/integration/session-start.integration.test.ts | n/a | single task |
| 1 | T1 | package.json, tsconfig.json | n/a | single task |
| 2 | T2, T3, T4 | T2: src/lib/validate-dirs.ts, tests/unit/validate-dirs.test.ts / T3: src/lib/assemble-context.ts, tests/unit/assemble-context.test.ts / T4: src/lib/hook-output.ts, tests/unit/hook-output.test.ts | yes | disjoint files, no shared state, no intra-wave deps |
| 3 | T5 | src/hooks/session-start.ts | n/a | single task (imports T2-T4 outputs) |
| 4 | T6 | src/cli.ts | n/a | single task (imports T5) |
| 5 | T7 | tests/integration/session-start.integration.test.ts | n/a | single task (reruns integration tests to pass) |

---

## Tasks

### Task 0: Integration Test (RED)

**Wave:** 0
**Depends on:** -

Write the integration test file that exercises the CLI as a subprocess. These tests will FAIL until the feature is fully implemented. They encode the Gherkin scenarios from the feature plan.

**Files:**
- Create: `tests/integration/session-start.integration.test.ts`

- [ ] **Step 1: Create the integration test file**

Create `tests/integration/session-start.integration.test.ts` with the following content. This file invokes the CLI entry point as a Bun subprocess and asserts stdout JSON, stderr messages, and exit codes.

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dirname, "../../src/cli.ts");

async function runCli(cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, "hooks", "session-start"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function createDotTwoBDirs(base: string, categories: string[] = ["system", "concepts", "instructions"]): Promise<void> {
  await mkdir(join(base, ".2b"), { recursive: true });
  for (const cat of categories) {
    await mkdir(join(base, ".2b", cat), { recursive: true });
  }
}

describe("CLI integration: hooks session-start", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-cli-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("assembles context from all three categories in fixed order", async () => {
    await createDotTwoBDirs(tmpDir);
    await writeFile(join(tmpDir, ".2b/system/persona.md"), "You are a helpful bot.");
    await writeFile(join(tmpDir, ".2b/concepts/architecture.md"), "The system uses microservices.");
    await writeFile(join(tmpDir, ".2b/instructions/formatting.md"), "Use markdown in responses.");

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const json = JSON.parse(stdout);
    expect(json.hookSpecificOutput).toBeDefined();
    expect(json.hookSpecificOutput.hookEventName).toBe("SessionStart");

    const content: string = json.hookSpecificOutput.additionalContext;
    const systemIdx = content.indexOf("## .2b/system/persona.md");
    const conceptsIdx = content.indexOf("## .2b/concepts/architecture.md");
    const instructionsIdx = content.indexOf("## .2b/instructions/formatting.md");

    expect(systemIdx).toBeGreaterThanOrEqual(0);
    expect(conceptsIdx).toBeGreaterThan(systemIdx);
    expect(instructionsIdx).toBeGreaterThan(conceptsIdx);

    expect(content).toContain("You are a helpful bot.");
    expect(content).toContain("The system uses microservices.");
    expect(content).toContain("Use markdown in responses.");
  });

  it("sorts files alphabetically within each category", async () => {
    await createDotTwoBDirs(tmpDir);
    await writeFile(join(tmpDir, ".2b/system/zebra.md"), "Z content");
    await writeFile(join(tmpDir, ".2b/system/alpha.md"), "A content");

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const content: string = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    const alphaIdx = content.indexOf("## .2b/system/alpha.md");
    const zebraIdx = content.indexOf("## .2b/system/zebra.md");

    expect(alphaIdx).toBeGreaterThanOrEqual(0);
    expect(zebraIdx).toBeGreaterThan(alphaIdx);
  });

  it("ignores non-markdown files in context directories", async () => {
    await createDotTwoBDirs(tmpDir);
    await writeFile(join(tmpDir, ".2b/system/context.md"), "Valid context.");
    await writeFile(join(tmpDir, ".2b/system/notes.txt"), "Ignored text.");
    await writeFile(join(tmpDir, ".2b/system/data.yaml"), "ignored: true");

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const content: string = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    expect(content).toContain("## .2b/system/context.md");
    expect(content).not.toContain("notes.txt");
    expect(content).not.toContain("data.yaml");
  });

  it("produces valid output when all category directories are empty", async () => {
    await createDotTwoBDirs(tmpDir);

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const json = JSON.parse(stdout);
    expect(json.hookSpecificOutput).toBeDefined();
    expect(json.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(json.hookSpecificOutput.additionalContext.trim()).toBe("");
  });

  it("prefixes each file section with its relative path as a markdown header", async () => {
    await createDotTwoBDirs(tmpDir);
    await writeFile(join(tmpDir, ".2b/system/persona.md"), "I am the system role.");

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const content: string = JSON.parse(stdout).hookSpecificOutput.additionalContext;
    const headerLine = "## .2b/system/persona.md";
    const headerIdx = content.indexOf(headerLine);
    expect(headerIdx).toBeGreaterThanOrEqual(0);

    const afterHeader = content.slice(headerIdx + headerLine.length).trimStart();
    expect(afterHeader.startsWith("I am the system role.")).toBe(true);
  });

  it("fails with non-zero exit when .2b/ directory is missing", async () => {
    const { stderr, exitCode } = await runCli(tmpDir);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/\.2b/);
  });

  it("fails with non-zero exit when system/ subdirectory is missing", async () => {
    await createDotTwoBDirs(tmpDir, ["concepts", "instructions"]);

    const { stderr, exitCode } = await runCli(tmpDir);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/system/);
  });

  it("fails with non-zero exit when concepts/ subdirectory is missing", async () => {
    await createDotTwoBDirs(tmpDir, ["system", "instructions"]);

    const { stderr, exitCode } = await runCli(tmpDir);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/concepts/);
  });

  it("fails with non-zero exit when instructions/ subdirectory is missing", async () => {
    await createDotTwoBDirs(tmpDir, ["system", "concepts"]);

    const { stderr, exitCode } = await runCli(tmpDir);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/instructions/);
  });
});
```

- [ ] **Step 2: Verify tests cannot run yet (no source files)**

Run: `bunx vitest run tests/integration/session-start.integration.test.ts 2>&1 || true`
Expected: Failure -- the CLI entry point (`src/cli.ts`) does not exist yet. This is expected RED state.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/session-start.integration.test.ts
git commit -m "test(context-assembly): add integration tests for hooks session-start (RED)"
```

---

### Task 1: Project Scaffolding

**Wave:** 1
**Depends on:** -

Create `package.json` and `tsconfig.json` at the repo root. Install dependencies. This is the foundation all other tasks build on.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Create package.json**

Create `package.json` with the following content:

```json
{
  "name": "@bugroger/2bd-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "2bd": "./src/cli.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "commander": "^13.1.0"
  },
  "devDependencies": {
    "vitest": "^3.1.1",
    "typescript": "^5.8.3",
    "@types/bun": "^1.2.9"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `tsconfig.json` with the following content:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "esnext",
    "module": "esnext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["bun-types"],
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `bun install`
Expected: Lockfile created, `node_modules/` populated, commander and vitest installed.

- [ ] **Step 4: Verify TypeScript compiles (vacuously)**

Run: `bunx tsc --noEmit`
Expected: Success (no source files to check yet, but config is valid).

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json bun.lock
git commit -m "chore(context-assembly): scaffold package.json and tsconfig.json"
```

---

### Task 2: Directory Validation Module

**Wave:** 2
**Depends on:** Task 1

A pure function that checks whether `.2b/` and its three required subdirectories exist under a given base path. Returns an error message string if validation fails, or `null` if everything is present.

**Files:**
- Create: `src/lib/validate-dirs.ts`
- Create: `tests/unit/validate-dirs.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/validate-dirs.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateDirs } from "../../src/lib/validate-dirs.js";

describe("validateDirs", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-validate-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null when .2b/ and all subdirectories exist", async () => {
    await mkdir(join(tmpDir, ".2b", "system"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "concepts"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "instructions"), { recursive: true });

    const result = await validateDirs(tmpDir);
    expect(result).toBeNull();
  });

  it("returns error message when .2b/ directory is missing", async () => {
    const result = await validateDirs(tmpDir);
    expect(result).not.toBeNull();
    expect(result).toContain(".2b");
  });

  it("returns error message identifying 'system' when system/ is missing", async () => {
    await mkdir(join(tmpDir, ".2b", "concepts"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "instructions"), { recursive: true });

    const result = await validateDirs(tmpDir);
    expect(result).not.toBeNull();
    expect(result).toContain("system");
  });

  it("returns error message identifying 'concepts' when concepts/ is missing", async () => {
    await mkdir(join(tmpDir, ".2b", "system"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "instructions"), { recursive: true });

    const result = await validateDirs(tmpDir);
    expect(result).not.toBeNull();
    expect(result).toContain("concepts");
  });

  it("returns error message identifying 'instructions' when instructions/ is missing", async () => {
    await mkdir(join(tmpDir, ".2b", "system"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "concepts"), { recursive: true });

    const result = await validateDirs(tmpDir);
    expect(result).not.toBeNull();
    expect(result).toContain("instructions");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/unit/validate-dirs.test.ts`
Expected: FAIL -- module `../../src/lib/validate-dirs.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/validate-dirs.ts`:

```typescript
import { stat } from "node:fs/promises";
import { join } from "node:path";

const REQUIRED_SUBDIRS = ["system", "concepts", "instructions"] as const;

export async function validateDirs(basePath: string): Promise<string | null> {
  const dotTwoBPath = join(basePath, ".2b");

  const dotTwoBExists = await dirExists(dotTwoBPath);
  if (!dotTwoBExists) {
    return `Required directory ".2b/" not found in ${basePath}`;
  }

  for (const subdir of REQUIRED_SUBDIRS) {
    const subdirPath = join(dotTwoBPath, subdir);
    const exists = await dirExists(subdirPath);
    if (!exists) {
      return `Required directory ".2b/${subdir}/" not found in ${basePath}`;
    }
  }

  return null;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/unit/validate-dirs.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validate-dirs.ts tests/unit/validate-dirs.test.ts
git commit -m "feat(context-assembly): add directory validation module with tests"
```

---

### Task 3: Context Assembly Module

**Wave:** 2
**Depends on:** Task 1

The core module that discovers `.md` files in each category directory (system, concepts, instructions), sorts them alphabetically, reads their contents, and builds a concatenated markdown string with `## <relative-path>` headers.

**Files:**
- Create: `src/lib/assemble-context.ts`
- Create: `tests/unit/assemble-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/assemble-context.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleContext } from "../../src/lib/assemble-context.js";

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

  it("assembles files from all three categories in fixed order", async () => {
    await writeFile(join(tmpDir, ".2b/system/persona.md"), "System content.");
    await writeFile(join(tmpDir, ".2b/concepts/arch.md"), "Concepts content.");
    await writeFile(join(tmpDir, ".2b/instructions/rules.md"), "Instructions content.");

    const result = await assembleContext(tmpDir);

    const systemIdx = result.indexOf("## .2b/system/persona.md");
    const conceptsIdx = result.indexOf("## .2b/concepts/arch.md");
    const instructionsIdx = result.indexOf("## .2b/instructions/rules.md");

    expect(systemIdx).toBeGreaterThanOrEqual(0);
    expect(conceptsIdx).toBeGreaterThan(systemIdx);
    expect(instructionsIdx).toBeGreaterThan(conceptsIdx);
  });

  it("sorts files alphabetically within a category", async () => {
    await writeFile(join(tmpDir, ".2b/system/zebra.md"), "Z");
    await writeFile(join(tmpDir, ".2b/system/alpha.md"), "A");
    await writeFile(join(tmpDir, ".2b/system/middle.md"), "M");

    const result = await assembleContext(tmpDir);

    const alphaIdx = result.indexOf("## .2b/system/alpha.md");
    const middleIdx = result.indexOf("## .2b/system/middle.md");
    const zebraIdx = result.indexOf("## .2b/system/zebra.md");

    expect(alphaIdx).toBeLessThan(middleIdx);
    expect(middleIdx).toBeLessThan(zebraIdx);
  });

  it("prefixes each file with ## <relative-path> header", async () => {
    await writeFile(join(tmpDir, ".2b/system/persona.md"), "Content here.");

    const result = await assembleContext(tmpDir);

    expect(result).toContain("## .2b/system/persona.md");
    const headerIdx = result.indexOf("## .2b/system/persona.md");
    const afterHeader = result.slice(headerIdx + "## .2b/system/persona.md".length).trimStart();
    expect(afterHeader.startsWith("Content here.")).toBe(true);
  });

  it("ignores non-markdown files", async () => {
    await writeFile(join(tmpDir, ".2b/system/valid.md"), "Valid.");
    await writeFile(join(tmpDir, ".2b/system/notes.txt"), "Ignored.");
    await writeFile(join(tmpDir, ".2b/system/data.yaml"), "ignored: true");

    const result = await assembleContext(tmpDir);

    expect(result).toContain("## .2b/system/valid.md");
    expect(result).not.toContain("notes.txt");
    expect(result).not.toContain("data.yaml");
  });

  it("returns empty string when all categories are empty", async () => {
    const result = await assembleContext(tmpDir);
    expect(result.trim()).toBe("");
  });

  it("handles mixed empty and non-empty categories", async () => {
    await writeFile(join(tmpDir, ".2b/concepts/design.md"), "Design notes.");

    const result = await assembleContext(tmpDir);

    expect(result).toContain("## .2b/concepts/design.md");
    expect(result).toContain("Design notes.");
    expect(result).not.toContain("## .2b/system/");
    expect(result).not.toContain("## .2b/instructions/");
  });

  it("includes full file content after each header", async () => {
    const multiLine = "Line one.\nLine two.\nLine three.";
    await writeFile(join(tmpDir, ".2b/system/multi.md"), multiLine);

    const result = await assembleContext(tmpDir);

    expect(result).toContain("Line one.\nLine two.\nLine three.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/unit/assemble-context.test.ts`
Expected: FAIL -- module `../../src/lib/assemble-context.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/assemble-context.ts`:

```typescript
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const CATEGORIES = ["system", "concepts", "instructions"] as const;

export async function assembleContext(basePath: string): Promise<string> {
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

  return sections.join("\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/unit/assemble-context.test.ts`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assemble-context.ts tests/unit/assemble-context.test.ts
git commit -m "feat(context-assembly): add context assembly module with tests"
```

---

### Task 4: Hook Output Module

**Wave:** 2
**Depends on:** Task 1

A pure function that takes a markdown string and wraps it in the Claude Code hook JSON contract. Returns the JSON string ready for stdout.

**Files:**
- Create: `src/lib/hook-output.ts`
- Create: `tests/unit/hook-output.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/hook-output.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildHookOutput } from "../../src/lib/hook-output.js";

describe("buildHookOutput", () => {
  it("wraps content in the hook JSON contract", () => {
    const result = buildHookOutput("Some markdown content.");
    const json = JSON.parse(result);

    expect(json).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "Some markdown content.",
      },
    });
  });

  it("produces valid JSON", () => {
    const result = buildHookOutput("Content with \"quotes\" and \nnewlines.");
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("handles empty string content", () => {
    const result = buildHookOutput("");
    const json = JSON.parse(result);

    expect(json.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(json.hookSpecificOutput.additionalContext).toBe("");
  });

  it("preserves the exact content string without modification", () => {
    const content = "## .2b/system/persona.md\n\nYou are helpful.\n\n## .2b/concepts/arch.md\n\nMicroservices.";
    const result = buildHookOutput(content);
    const json = JSON.parse(result);

    expect(json.hookSpecificOutput.additionalContext).toBe(content);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/unit/hook-output.test.ts`
Expected: FAIL -- module `../../src/lib/hook-output.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/hook-output.ts`:

```typescript
interface HookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

export function buildHookOutput(additionalContext: string): string {
  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
  };
  return JSON.stringify(output);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/unit/hook-output.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hook-output.ts tests/unit/hook-output.test.ts
git commit -m "feat(context-assembly): add hook output module with tests"
```

---

### Task 5: Session-Start Orchestrator

**Wave:** 3
**Depends on:** Task 2, Task 3, Task 4

The orchestrator function for the `hooks session-start` subcommand. It calls `validateDirs`, then `assembleContext`, then `buildHookOutput`, writes the result to stdout, or writes an error to stderr and exits non-zero.

**Files:**
- Create: `src/hooks/session-start.ts`

- [ ] **Step 1: Write the orchestrator**

Create `src/hooks/session-start.ts`:

```typescript
import { validateDirs } from "../lib/validate-dirs.js";
import { assembleContext } from "../lib/assemble-context.js";
import { buildHookOutput } from "../lib/hook-output.js";

export async function sessionStartAction(): Promise<void> {
  const cwd = process.cwd();

  const validationError = await validateDirs(cwd);
  if (validationError !== null) {
    process.stderr.write(`Error: ${validationError}\n`);
    process.exit(1);
  }

  const markdown = await assembleContext(cwd);
  const json = buildHookOutput(markdown);

  process.stdout.write(json + "\n");
}
```

- [ ] **Step 2: Verify all unit tests still pass**

Run: `bunx vitest run tests/unit/`
Expected: All unit tests (16 total) PASS. This verifies the orchestrator's dependencies are healthy.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/session-start.ts
git commit -m "feat(context-assembly): add session-start orchestrator"
```

---

### Task 6: CLI Entry Point

**Wave:** 4
**Depends on:** Task 5

Create the CLI entry point with a shebang, commander setup, and the `hooks session-start` subcommand registration.

**Files:**
- Create: `src/cli.ts`

- [ ] **Step 1: Write the CLI entry point**

Create `src/cli.ts`:

```typescript
#!/usr/bin/env bun
import { Command } from "commander";
import { sessionStartAction } from "./hooks/session-start.js";

const program = new Command();

program
  .name("2bd")
  .description("Developer tooling CLI for structured context management");

const hooks = program
  .command("hooks")
  .description("Claude Code hook integrations");

hooks
  .command("session-start")
  .description("Assemble .2b/ context and output hook-compatible JSON")
  .action(sessionStartAction);

program.parse();
```

- [ ] **Step 2: Make the entry point executable**

Run: `chmod +x src/cli.ts`

- [ ] **Step 3: Smoke test the CLI help output**

Run: `bun run src/cli.ts --help`
Expected: Output shows the `2bd` command with `hooks` listed as a subcommand.

- [ ] **Step 4: Smoke test the hooks subcommand help**

Run: `bun run src/cli.ts hooks --help`
Expected: Output shows the `hooks` command with `session-start` listed as a subcommand.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(context-assembly): add CLI entry point with commander"
```

---

### Task 7: Integration Tests GREEN

**Wave:** 5
**Depends on:** Task 0, Task 6

Run the integration tests written in Task 0. They should now pass because all source code is in place. If any test fails, debug and fix the issue in the relevant source file.

**Files:**
- Modify: `tests/integration/session-start.integration.test.ts` (only if test adjustments are needed)

- [ ] **Step 1: Run all unit tests to confirm they pass**

Run: `bunx vitest run tests/unit/`
Expected: All 16 unit tests PASS.

- [ ] **Step 2: Run integration tests**

Run: `bunx vitest run tests/integration/session-start.integration.test.ts`
Expected: All 9 integration tests PASS. If any fail, debug the stdout/stderr output and fix the relevant source module.

- [ ] **Step 3: Run the full test suite**

Run: `bunx vitest run`
Expected: All 25 tests (16 unit + 9 integration) PASS.

- [ ] **Step 4: Manual smoke test against a real .2b/ directory**

```bash
mkdir -p /tmp/2bd-smoke/.2b/system /tmp/2bd-smoke/.2b/concepts /tmp/2bd-smoke/.2b/instructions
echo "You are a helpful assistant." > /tmp/2bd-smoke/.2b/system/persona.md
echo "We use event-driven architecture." > /tmp/2bd-smoke/.2b/concepts/architecture.md
cd /tmp/2bd-smoke && bun run <absolute-path-to-repo>/src/cli.ts hooks session-start
```

Expected: Valid JSON output to stdout containing both files in category order, with `hookEventName: "SessionStart"`.

- [ ] **Step 5: Commit (only if test adjustments were needed)**

```bash
git add -A
git commit -m "test(context-assembly): integration tests GREEN"
```

---

## Acceptance Criteria Traceability

| Acceptance Criterion | Task(s) |
|---|---|
| `bunx @bugroger/2bd-cli hooks session-start` executes successfully | T6, T7 |
| Output is valid JSON matching hook contract | T4, T5, T7 |
| Files read in fixed category order: system -> concepts -> instructions | T3, T7 |
| Files sorted alphabetically within each category | T3, T7 |
| Each file section prefixed with `## .2b/<category>/<filename>` | T3, T7 |
| Non-markdown files ignored | T3, T7 |
| Empty category directories produce no sections | T3, T7 |
| Missing `.2b/` causes non-zero exit with stderr message | T2, T5, T7 |
| Missing subdirectory causes non-zero exit with stderr message | T2, T5, T7 |
| `package.json` has correct name, bin, and commander dependency | T1 |
| TypeScript compiles in strict mode, ESM-only | T1 |
| Unit tests pass for assembly logic | T2, T3, T4 |
| Integration tests pass for CLI invocation | T0, T7 |
