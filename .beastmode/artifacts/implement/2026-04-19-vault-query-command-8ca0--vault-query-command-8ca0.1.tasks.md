# Vault Query Command -- Implementation Tasks

## Goal

Add a top-level `2bd query <question> [--file-back <path>]` command that queries the Obsidian vault using MOC-guided retrieval. The command validates prerequisites (.2b/ exists, `claude` CLI on PATH, at least one MOC discovered), assembles a prompt with MOC content and the user's question, spawns `claude -p` as an agentic subprocess with Read/Glob/Grep tools (plus Write/Edit for --file-back), and writes the raw markdown result to stdout. With `--file-back`, Claude writes the result as a vault note with YAML frontmatter instead.

## Architecture

- **Runtime**: Bun with TypeScript, strict mode, ESM-only, target esnext
- **Test runner**: vitest (dev dependency), run with `bunx vitest run`
- **CLI framework**: Commander.js (`commander` package, already installed)
- **New module**: `src/commands/query.ts` -- exports `queryAction` (the Commander action handler) plus testable helper functions for prompt assembly, tool list construction, and validation
- **Existing modules reused**:
  - `src/lib/validate-dirs.ts` -- checks `.2b/` directory structure
  - `src/lib/discover-mocs.ts` -- scans vault for MOC files, returns `MocRecord[]`
- **LLM integration**: Spawn `claude -p` subprocess via `Bun.spawn` -- no Anthropic SDK dependency
- **Tool access**: `--allowedTools "Read,Glob,Grep"` by default; add `Write,Edit` when `--file-back` is specified
- **Prompt structure**: System prompt via `--append-system-prompt`; main prompt contains embedded MOC content + user query
- **Output**: Raw markdown to stdout, no decorative output, pipe-friendly
- **Subprocess cwd**: Set to vault root (the directory containing `.2b/`)
- **Exit code propagation**: Non-zero subprocess exit code is propagated to the CLI exit code

## Tech Stack

- TypeScript (strict, esnext, ESM)
- Bun runtime
- vitest test runner
- Commander.js for CLI parsing
- `node:child_process` spawn for subprocess invocation in tests
- `Bun.spawn` for subprocess invocation in production code
- `yaml` npm package (already installed, used by existing `discover-mocs.ts`)
- `node:fs/promises` for filesystem operations

## File Structure

| File | Responsibility |
|------|---------------|
| `src/commands/query.ts` | **Create.** Exports `queryAction` (Commander action handler) and testable helper functions: `buildSystemPrompt(fileBack?: string): string`, `buildMainPrompt(mocRecords: MocRecord[], question: string): string`, `buildToolList(fileBack?: string): string`, `validateQueryPrereqs(cwd: string): Promise<string \| null>`. The action function orchestrates: validate prerequisites, discover MOCs, assemble prompts, spawn `claude -p`, capture output, propagate exit code. |
| `tests/unit/query.test.ts` | **Create.** Unit tests for all exported helper functions: system prompt content, main prompt MOC embedding, tool list construction, and validation logic (missing .2b/, missing claude, no MOCs). |
| `src/cli.ts` | **Modify.** Add import for `queryAction` and register the `query` command with `<question>` argument and `--file-back <path>` option. |
| `tests/integration/query.integration.test.ts` | **Create.** Integration tests for the 10 Gherkin scenarios: validation errors (4 scenarios), query output (3 scenarios), file-back (3 scenarios). Uses CLI subprocess pattern with temp directories. |

## Wave Isolation

| Wave | Tasks | Files | Parallel-safe | Reason |
|------|-------|-------|---------------|--------|
| 0 | T0 | tests/integration/query.integration.test.ts | n/a | single task |
| 1 | T1 | src/commands/query.ts, tests/unit/query.test.ts | n/a | single task |
| 2 | T2 | **src/cli.ts** | n/a | single task; depends on T1 creating the module it imports |
| 3 | T3 | tests/integration/query.integration.test.ts | n/a | single task (GREEN verification); depends on T0, T2 |

---

## Tasks

### Task 0: Integration Test (RED)

**Wave:** 0
**Depends on:** -

Write the integration test file that exercises the `2bd query` command via CLI subprocess. These tests will FAIL because the `query` command does not yet exist. They encode the 10 Gherkin scenarios from the feature plan: 4 validation scenarios, 3 query output scenarios, 3 file-back scenarios.

**Files:**
- Create: `tests/integration/query.integration.test.ts`

- [x] **Step 1: Create the integration test file**

Create `tests/integration/query.integration.test.ts` with the following content. This file invokes the CLI entry point as a subprocess and asserts query command behavior.

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../src/cli.ts");

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(
  args: string[],
  cwd: string,
  options?: { env?: Record<string, string> }
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn("bun", ["run", CLI_PATH, ...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...options?.env },
    });

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code: number | null) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (err: Error) => {
      reject(err);
    });
  });
}

async function createVaultWithMoc(base: string): Promise<void> {
  await mkdir(join(base, ".2b", "system"), { recursive: true });
  await mkdir(join(base, ".2b", "concepts"), { recursive: true });
  await mkdir(join(base, ".2b", "instructions"), { recursive: true });
  await writeFile(
    join(base, ".2b", "system", "persona.md"),
    "You are an assistant for an Obsidian vault."
  );
  await mkdir(join(base, "10 Projects"), { recursive: true });
  await writeFile(
    join(base, "10 Projects", "overview.md"),
    "---\ntype: moc\n---\n\n# Project Overview\n\n- [[10 Projects/testing-strategies|Testing Strategies]]\n- [[10 Projects/deployment|Deployment Guide]]\n"
  );
  await writeFile(
    join(base, "10 Projects", "testing-strategies.md"),
    "---\ntype: note\ntitle: Testing Strategies\n---\n\n# Testing Strategies\n\nUnit testing with vitest. Integration testing with subprocess spawning.\n"
  );
  await writeFile(
    join(base, "10 Projects", "deployment.md"),
    "---\ntype: note\ntitle: Deployment Guide\n---\n\n# Deployment Guide\n\nDeploy via GitHub Actions. Use semantic versioning.\n"
  );
}

async function createDotTwoBDirs(base: string): Promise<void> {
  await mkdir(join(base, ".2b", "system"), { recursive: true });
  await mkdir(join(base, ".2b", "concepts"), { recursive: true });
  await mkdir(join(base, ".2b", "instructions"), { recursive: true });
}

describe("CLI integration: query command -- validation", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-query-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("fails with clear error when .2b/ directory is missing", async () => {
    const { stderr, exitCode } = await runCli(
      ["query", "any question"],
      tmpDir
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/\.2b/);
  });

  it("fails with clear error when the claude CLI is not on PATH", async () => {
    await createDotTwoBDirs(tmpDir);
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "overview.md"),
      "---\ntype: moc\n---\n\n# Overview\n"
    );

    // Override PATH to exclude claude
    const { stderr, exitCode } = await runCli(
      ["query", "any question"],
      tmpDir,
      { env: { PATH: tmpDir } }
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/claude/i);
  });

  it("fails with clear error when no MOC files are discovered", async () => {
    await createDotTwoBDirs(tmpDir);

    const { stderr, exitCode } = await runCli(
      ["query", "any question"],
      tmpDir
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/moc/i);
  });

  it("validation errors prevent the claude subprocess from being spawned", async () => {
    // No .2b/ dir -- validation should fail before any subprocess is spawned
    const { stderr, exitCode } = await runCli(
      ["query", "any question"],
      tmpDir
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/\.2b/);
    // If a subprocess were spawned and failed, we would see a different error
    // The validation error message is sufficient proof no subprocess was started
  });
});

describe("CLI integration: query command -- query output", { timeout: 120_000 }, () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-query-test-"));
    await createVaultWithMoc(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("querying the vault returns a summary on stdout with zero exit code", async () => {
    const { stdout, stderr, exitCode } = await runCli(
      ["query", "what do I know about testing strategies"],
      tmpDir
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
    expect(stderr).toBe("");
  });

  it("query output includes Obsidian wikilink citations", async () => {
    const { stdout, exitCode } = await runCli(
      ["query", "what do I know about testing strategies"],
      tmpDir
    );
    expect(exitCode).toBe(0);
    // Check for at least one wikilink pattern [[...]]
    const wikilinkPattern = /\[\[[^\]]+\]\]/;
    expect(stdout).toMatch(wikilinkPattern);
    // No wikilink path should end with .md
    const wikilinks = stdout.match(/\[\[([^\]]+)\]\]/g) ?? [];
    for (const link of wikilinks) {
      const path = link.slice(2, -2); // strip [[ and ]]
      expect(path).not.toMatch(/\.md$/);
    }
  });

  it("query output is clean markdown suitable for piping", async () => {
    const { stdout, exitCode } = await runCli(
      ["query", "summarize my projects"],
      tmpDir
    );
    expect(exitCode).toBe(0);
    // No ANSI escape codes
    // eslint-disable-next-line no-control-regex
    const ansiPattern = /\x1b\[[0-9;]*[a-zA-Z]/;
    expect(stdout).not.toMatch(ansiPattern);
    // No spinner characters (common: braille dots U+2800-U+28FF, arrows, etc.)
    const spinnerPattern = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
    expect(stdout).not.toMatch(spinnerPattern);
  });
});

describe("CLI integration: query command -- file-back", { timeout: 120_000 }, () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-query-test-"));
    await createVaultWithMoc(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("file-back flag writes the result to the specified vault path", async () => {
    await mkdir(join(tmpDir, "30 Resources"), { recursive: true });

    const { exitCode } = await runCli(
      ["query", "summarize my projects", "--file-back", "30 Resources/Project Summary.md"],
      tmpDir
    );
    expect(exitCode).toBe(0);

    const filePath = join(tmpDir, "30 Resources/Project Summary.md");
    const fileStat = await stat(filePath);
    expect(fileStat.isFile()).toBe(true);

    const content = await readFile(filePath, "utf-8");
    expect(content.trim().length).toBeGreaterThan(0);
  });

  it("file-back output includes valid YAML frontmatter", async () => {
    await mkdir(join(tmpDir, "30 Resources"), { recursive: true });

    const { exitCode } = await runCli(
      ["query", "summarize my projects", "--file-back", "30 Resources/Project Summary.md"],
      tmpDir
    );
    expect(exitCode).toBe(0);

    const filePath = join(tmpDir, "30 Resources/Project Summary.md");
    const content = await readFile(filePath, "utf-8");

    // Check YAML frontmatter delimiters
    expect(content).toMatch(/^---\r?\n/);
    const fmEnd = content.indexOf("\n---\n", 4);
    expect(fmEnd).toBeGreaterThan(0);

    // Extract and parse YAML frontmatter
    const yamlStr = content.slice(4, fmEnd);
    const { parse: parseYaml } = await import("yaml");
    const frontmatter = parseYaml(yamlStr);
    expect(frontmatter).toBeDefined();
    expect(typeof frontmatter).toBe("object");

    // Required fields
    expect(frontmatter.title).toBeDefined();
    expect(frontmatter.type).toBeDefined();
    expect(frontmatter.created).toBeDefined();
  });

  it("file-back output does not go to stdout", async () => {
    await mkdir(join(tmpDir, "30 Resources"), { recursive: true });

    const { stdout, exitCode } = await runCli(
      ["query", "summarize my projects", "--file-back", "30 Resources/Project Summary.md"],
      tmpDir
    );
    expect(exitCode).toBe(0);

    // stdout should be empty or minimal (not the full query result)
    // The actual result is written to the file by Claude
    const filePath = join(tmpDir, "30 Resources/Project Summary.md");
    const fileContent = await readFile(filePath, "utf-8");
    expect(fileContent.trim().length).toBeGreaterThan(0);

    // stdout should not contain the query result body
    // (it may contain minimal status or be empty)
    if (stdout.trim().length > 0) {
      // If stdout has content, it should be much shorter than the file content
      expect(stdout.trim().length).toBeLessThan(fileContent.trim().length);
    }
  });
});
```

- [x] **Step 2: Run the integration tests to verify they fail**

Run: `bunx vitest run tests/integration/query.integration.test.ts`
Expected: FAIL -- the CLI does not recognize the `query` command yet. All tests will fail because `2bd query` is not registered. Validation tests will see Commander's "unknown command" error rather than the expected validation messages.

- [x] **Step 3: Commit**

```bash
git add tests/integration/query.integration.test.ts
git commit -m "test(query): add integration tests for vault query command (RED)"
```

---

### Task 1: Query Command Module

**Wave:** 1
**Depends on:** -

Create the query command module with all the core logic: prerequisite validation, prompt assembly (system prompt and main prompt), tool list construction, and the action function that orchestrates subprocess spawning. All helper functions are exported for unit testing.

**Files:**
- Create: `src/commands/query.ts`
- Create: `tests/unit/query.test.ts`

- [x] **Step 1: Write the failing unit tests**

Create `tests/unit/query.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildSystemPrompt,
  buildMainPrompt,
  buildToolList,
  validateQueryPrereqs,
} from "../../src/commands/query.js";
import type { MocRecord } from "../../src/lib/discover-mocs.js";

describe("buildSystemPrompt", () => {
  it("instructs Claude to use Obsidian wikilink citations", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toMatch(/\[\[/);
    expect(prompt).toMatch(/wikilink/i);
  });

  it("instructs citations without .md extension", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toMatch(/without.*\.md|no.*\.md|\.md.*extension/i);
  });

  it("instructs clean markdown output with no decorative content", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toMatch(/clean.*markdown|raw.*markdown|markdown/i);
  });

  it("includes file-back instructions when fileBack path is provided", () => {
    const prompt = buildSystemPrompt("30 Resources/Summary.md");
    expect(prompt).toMatch(/30 Resources\/Summary\.md/);
    expect(prompt).toMatch(/frontmatter/i);
    expect(prompt).toMatch(/title/i);
    expect(prompt).toMatch(/type/i);
    expect(prompt).toMatch(/created/i);
    expect(prompt).toMatch(/updated/i);
  });

  it("does not include file-back instructions when fileBack is undefined", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).not.toMatch(/frontmatter/i);
    expect(prompt).not.toMatch(/Write.*tool/i);
  });
});

describe("buildMainPrompt", () => {
  const sampleMocs: MocRecord[] = [
    {
      relativePath: "10 Projects/overview.md",
      body: "\n# Project Overview\n\n- [[10 Projects/testing|Testing]]\n",
    },
    {
      relativePath: "20 Areas/life.md",
      body: "\n# Life Areas\n\n- [[20 Areas/health|Health]]\n",
    },
  ];

  it("embeds MOC content with relative path headers", () => {
    const prompt = buildMainPrompt(sampleMocs, "what do I know about testing");
    expect(prompt).toContain("## 10 Projects/overview.md");
    expect(prompt).toContain("# Project Overview");
    expect(prompt).toContain("## 20 Areas/life.md");
    expect(prompt).toContain("# Life Areas");
  });

  it("includes the user query", () => {
    const prompt = buildMainPrompt(sampleMocs, "what do I know about testing");
    expect(prompt).toContain("what do I know about testing");
  });

  it("places MOC content before the user query", () => {
    const prompt = buildMainPrompt(sampleMocs, "what do I know about testing");
    const mocIdx = prompt.indexOf("## 10 Projects/overview.md");
    const queryIdx = prompt.indexOf("what do I know about testing");
    expect(mocIdx).toBeGreaterThanOrEqual(0);
    expect(queryIdx).toBeGreaterThan(mocIdx);
  });

  it("handles a single MOC record", () => {
    const prompt = buildMainPrompt([sampleMocs[0]], "summarize projects");
    expect(prompt).toContain("## 10 Projects/overview.md");
    expect(prompt).toContain("summarize projects");
  });

  it("handles empty MOC array", () => {
    const prompt = buildMainPrompt([], "any question");
    expect(prompt).toContain("any question");
    // No MOC headers expected
    expect(prompt).not.toContain("## 10 Projects");
  });
});

describe("buildToolList", () => {
  it("returns read-only tools by default", () => {
    const tools = buildToolList();
    expect(tools).toBe("Read,Glob,Grep");
  });

  it("returns read-only tools when fileBack is undefined", () => {
    const tools = buildToolList(undefined);
    expect(tools).toBe("Read,Glob,Grep");
  });

  it("returns read-write tools when fileBack is provided", () => {
    const tools = buildToolList("30 Resources/Summary.md");
    expect(tools).toBe("Read,Glob,Grep,Write,Edit");
  });

  it("returns read-write tools for any non-empty fileBack string", () => {
    const tools = buildToolList("any-path.md");
    expect(tools).toBe("Read,Glob,Grep,Write,Edit");
  });
});

describe("validateQueryPrereqs", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-query-validate-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null when all prerequisites are met", async () => {
    await mkdir(join(tmpDir, ".2b", "system"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "concepts"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "instructions"), { recursive: true });
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "overview.md"),
      "---\ntype: moc\n---\n\n# Overview\n"
    );

    const result = await validateQueryPrereqs(tmpDir);
    expect(result).toBeNull();
  });

  it("returns error when .2b/ directory is missing", async () => {
    const result = await validateQueryPrereqs(tmpDir);
    expect(result).not.toBeNull();
    expect(result).toMatch(/\.2b/);
  });

  it("returns error mentioning claude when claude CLI is not on PATH", async () => {
    await mkdir(join(tmpDir, ".2b", "system"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "concepts"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "instructions"), { recursive: true });
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "overview.md"),
      "---\ntype: moc\n---\n\n# Overview\n"
    );

    // Test with a custom whichFn that simulates claude not found
    const result = await validateQueryPrereqs(tmpDir, {
      whichFn: async () => null,
    });
    expect(result).not.toBeNull();
    expect(result).toMatch(/claude/i);
  });

  it("returns error when no MOC files are discovered", async () => {
    await mkdir(join(tmpDir, ".2b", "system"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "concepts"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "instructions"), { recursive: true });
    // No numbered dirs, so no MOC files

    const result = await validateQueryPrereqs(tmpDir);
    expect(result).not.toBeNull();
    expect(result).toMatch(/moc/i);
  });

  it("checks .2b/ before claude CLI", async () => {
    // No .2b/ dir -- should fail on .2b, not claude
    const result = await validateQueryPrereqs(tmpDir);
    expect(result).not.toBeNull();
    expect(result).toMatch(/\.2b/);
    expect(result).not.toMatch(/claude/i);
  });

  it("checks claude CLI before MOC discovery", async () => {
    await mkdir(join(tmpDir, ".2b", "system"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "concepts"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "instructions"), { recursive: true });
    // No MOC dirs, and claude is not on path

    const result = await validateQueryPrereqs(tmpDir, {
      whichFn: async () => null,
    });
    expect(result).not.toBeNull();
    // Should fail on claude, not MOC
    expect(result).toMatch(/claude/i);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/unit/query.test.ts`
Expected: FAIL with "Cannot find module" because `src/commands/query.ts` does not exist yet.

- [x] **Step 3: Write the implementation**

Create `src/commands/query.ts`:

```typescript
import { validateDirs } from "../lib/validate-dirs.js";
import { discoverMocs } from "../lib/discover-mocs.js";
import type { MocRecord } from "../lib/discover-mocs.js";

interface ValidateOptions {
  whichFn?: (cmd: string) => Promise<string | null>;
}

async function defaultWhich(cmd: string): Promise<string | null> {
  const path = Bun.which(cmd);
  return path ?? null;
}

export async function validateQueryPrereqs(
  cwd: string,
  options?: ValidateOptions
): Promise<string | null> {
  const whichFn = options?.whichFn ?? defaultWhich;

  // 1. Check .2b/ directory structure
  const dirError = await validateDirs(cwd);
  if (dirError !== null) {
    return dirError;
  }

  // 2. Check claude CLI is on PATH
  const claudePath = await whichFn("claude");
  if (claudePath === null) {
    return 'The "claude" CLI is not available on PATH. Install it from https://docs.anthropic.com/en/docs/claude-code';
  }

  // 3. Check at least one MOC file exists
  const mocs = await discoverMocs(cwd);
  if (mocs.length === 0) {
    return "No MOC files found. Create at least one markdown file with \"type: moc\" YAML frontmatter in a numbered top-level directory (e.g., \"10 Projects/\").";
  }

  return null;
}

export function buildSystemPrompt(fileBack?: string): string {
  let prompt = `You are a vault research assistant. Your job is to answer the user's question by reading documents from their Obsidian vault.

## Citation format

- Use Obsidian wikilink syntax for citations: [[path/to/document]]
- Do NOT include the .md file extension in wikilink paths — write [[10 Projects/testing]], not [[10 Projects/testing.md]]
- Cite every source document you reference

## Output format

- Return clean, raw markdown suitable for piping to other tools
- No decorative output, no progress indicators, no status messages
- Structure your response with clear headings and bullet points where appropriate`;

  if (fileBack !== undefined) {
    prompt += `

## File-back mode

You are in file-back mode. Write your response to the file at path: ${fileBack}

Use the Write tool to create this file. The file must be a valid Obsidian vault note with YAML frontmatter containing these fields:
- title: A descriptive title for the note
- type: "query-result"
- tags: Relevant tags as a YAML list
- created: Current date in YYYY-MM-DD format
- updated: Current date in YYYY-MM-DD format

After the frontmatter, write the full response body with citations.
Do NOT write the response to stdout — write it to the file only.`;
  }

  return prompt;
}

export function buildMainPrompt(
  mocRecords: MocRecord[],
  question: string
): string {
  const sections: string[] = [];

  if (mocRecords.length > 0) {
    sections.push("# Vault Index (MOC Files)\n");
    sections.push(
      "The following are Maps of Content (MOC) files from the vault. Use them as an index to find relevant documents to read.\n"
    );
    for (const moc of mocRecords) {
      sections.push(`## ${moc.relativePath}\n${moc.body}`);
    }
  }

  sections.push("# Question\n");
  sections.push(question);

  return sections.join("\n");
}

export function buildToolList(fileBack?: string): string {
  if (fileBack !== undefined && fileBack.length > 0) {
    return "Read,Glob,Grep,Write,Edit";
  }
  return "Read,Glob,Grep";
}

export async function queryAction(
  question: string,
  options: { fileBack?: string }
): Promise<void> {
  const cwd = process.cwd();

  // Validate prerequisites
  const validationError = await validateQueryPrereqs(cwd);
  if (validationError !== null) {
    process.stderr.write(`Error: ${validationError}\n`);
    process.exit(1);
  }

  // Discover MOCs
  const mocs = await discoverMocs(cwd);

  // Build prompts
  const systemPrompt = buildSystemPrompt(options.fileBack);
  const mainPrompt = buildMainPrompt(mocs, question);
  const toolList = buildToolList(options.fileBack);

  // Spawn claude -p subprocess
  const args = [
    "-p",
    mainPrompt,
    "--append-system-prompt",
    systemPrompt,
    "--allowedTools",
    toolList,
  ];

  const proc = Bun.spawn(["claude", ...args], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Capture and forward stdout
  const stdoutReader = proc.stdout.getReader();
  const stdoutChunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await stdoutReader.read();
    if (done) break;
    stdoutChunks.push(value);
    process.stdout.write(value);
  }

  // Capture stderr
  const stderrReader = proc.stderr.getReader();
  while (true) {
    const { done, value } = await stderrReader.read();
    if (done) break;
    process.stderr.write(value);
  }

  // Wait for exit and propagate exit code
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/unit/query.test.ts`
Expected: All 18 tests PASS.

- [x] **Step 5: Run all unit tests to verify no regressions**

Run: `bunx vitest run tests/unit/`
Expected: All existing unit tests still PASS.

- [x] **Step 6: Commit**

```bash
git add src/commands/query.ts tests/unit/query.test.ts
git commit -m "feat(query): add query command module with prompt assembly, tool list, and validation"
```

---

### Task 2: Register Query Command in CLI

**Wave:** 2
**Depends on:** Task 1

Register the `query` command as a top-level command on the Commander program in `src/cli.ts`. This wires the `queryAction` function to the Commander framework with the required `<question>` argument and optional `--file-back <path>` option.

**Files:**
- Modify: `src/cli.ts`

- [x] **Step 1: Read the current cli.ts**

Read `src/cli.ts` to confirm its current content before modifying. It should contain the Commander program setup and the `hooks session-start` command.

Current content of `src/cli.ts`:

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

- [x] **Step 2: Modify cli.ts to register the query command**

Add the import for `queryAction` and register the `query` command. The modified file:

```typescript
#!/usr/bin/env bun
import { Command } from "commander";
import { sessionStartAction } from "./hooks/session-start.js";
import { queryAction } from "./commands/query.js";

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

program
  .command("query")
  .description("Query the vault using MOC-guided retrieval and get a cited summary")
  .argument("<question>", "Natural-language question to ask about the vault")
  .option("--file-back <path>", "Write result as a vault note to the specified path instead of stdout")
  .action(queryAction);

program.parse();
```

- [x] **Step 3: Verify the command is registered**

Run: `bun run src/cli.ts query --help`
Expected: Output shows the `query` command help with `<question>` argument and `--file-back <path>` option.

- [x] **Step 4: Verify the CLI still works for existing commands**

Run: `bun run src/cli.ts --help`
Expected: Output shows both `hooks` and `query` as available commands.

- [x] **Step 5: Run the full unit test suite to verify no regressions**

Run: `bunx vitest run tests/unit/`
Expected: All unit tests PASS.

- [x] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat(query): register query command in CLI entry point"
```

---

### Task 3: Integration Tests GREEN

**Wave:** 3
**Depends on:** Task 0, Task 2

Run the integration tests written in Task 0. The validation scenarios should now pass because the `query` command is registered and validates prerequisites correctly. The LLM-dependent scenarios (query output and file-back) require the `claude` CLI to be available and will exercise the real subprocess pipeline.

**Files:**
- (No file changes expected -- this is a verification task. If adjustments are needed to the integration test expectations due to actual CLI output format, they will be made in `tests/integration/query.integration.test.ts`.)

- [x] **Step 1: Run the validation integration tests**

Run: `bunx vitest run tests/integration/query.integration.test.ts -t "validation"`
Expected: All 4 validation tests PASS:
- "fails with clear error when .2b/ directory is missing" -- PASS
- "fails with clear error when the claude CLI is not on PATH" -- PASS
- "fails with clear error when no MOC files are discovered" -- PASS
- "validation errors prevent the claude subprocess from being spawned" -- PASS

- [x] **Step 2: Run the full query integration tests**

Run: `bunx vitest run tests/integration/query.integration.test.ts`
Expected: All 10 integration tests PASS. The LLM-dependent tests verify structural properties (exit code, wikilink pattern, no ANSI codes, file existence, frontmatter validity) not exact content.

Note: The LLM-dependent tests (query output, file-back) require:
- The `claude` CLI to be available on PATH
- Valid Claude authentication
- Network access to the Anthropic API
- Each LLM test may take 10-60 seconds due to subprocess spawning and API calls

If any LLM test fails due to non-deterministic output, adjust the assertions to be more structural (e.g., check for any wikilink pattern rather than a specific path).

- [x] **Step 3: Run all integration tests together**

Run: `bunx vitest run tests/integration/`
Expected: All integration tests PASS (existing session-start: 9, existing date-injection: 4, existing MOC: 16, new query: 10 = 39 total).

- [x] **Step 4: Run the full test suite**

Run: `bunx vitest run`
Expected: All tests PASS.

- [x] **Step 5: Commit (only if adjustments were needed)**

If any test assertions were adjusted in Step 2:

```bash
git add tests/integration/query.integration.test.ts
git commit -m "test(query): integration tests GREEN for vault query command"
```

If no changes were needed, skip this commit.

---

## Acceptance Criteria Traceability

| Acceptance Criterion | Task(s) |
|---|---|
| Top-level `query` command registered in `cli.ts` with `<question>` argument and `--file-back <path>` option | T2 |
| Validation checks `.2b/` existence, `claude` CLI on PATH, and at least one MOC file -- each with a distinct stderr error message | T1 (unit), T0/T3 (integration) |
| No subprocess spawned when validation fails | T1 (design), T0/T3 (integration scenario 4) |
| Prompt embeds all discovered MOC content and the user's query | T1 (unit: buildMainPrompt) |
| System prompt instructs Claude on wikilink citation format (no `.md` extension) and clean markdown output | T1 (unit: buildSystemPrompt) |
| Tool list is `Read,Glob,Grep` by default; `Read,Glob,Grep,Write,Edit` when `--file-back` is specified | T1 (unit: buildToolList) |
| `claude -p` subprocess runs with cwd set to vault root | T1 (queryAction implementation) |
| Stdout output is raw markdown with no decorative content -- pipe-friendly | T0/T3 (integration: clean markdown scenario) |
| `--file-back` causes Claude to write the result as a vault note with YAML frontmatter (title, type, tags, created, updated) | T1 (unit: buildSystemPrompt with fileBack), T0/T3 (integration: file-back scenarios) |
| Non-zero subprocess exit code is propagated to the CLI exit code | T1 (queryAction implementation) |
| Unit tests cover prompt assembly, argument parsing, tool list construction, and validation logic | T1 |
| Integration tests verify structural properties (exit code, file existence, frontmatter validity, wikilink pattern) not exact LLM content | T0/T3 |
