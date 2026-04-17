# MOC Discovery and Assembly -- Implementation Tasks

## Goal

Extend the session-start hook's context assembly to automatically discover MOC (Map of Content) files from Obsidian-style numbered top-level directories (`/^\d{2} /` pattern), strip their YAML frontmatter, and append their body content after the existing `.2b/` category output. MOC files are identified by `type: moc` in their YAML frontmatter. Sorting is by full relative path with natural/numeric ordering. When no MOC files or numbered directories exist, the output is identical to the pre-feature behavior.

## Architecture

- **Runtime**: Bun with TypeScript, strict mode, ESM-only, target esnext
- **Test runner**: vitest (dev dependency), run with `bunx vitest run`
- **New production dependency**: `yaml` package for YAML frontmatter parsing
- **MOC discovery module**: Pure async function `discoverMocs(basePath: string): Promise<MocRecord[]>` that scans numbered top-level directories for `.md` files with `type: moc` frontmatter
- **Integration**: `assembleContext` calls `discoverMocs` after the `.2b/` category loop and appends MOC sections
- **Header format**: `## relative/path/to/file.md` (consistent with existing `.2b/` file headers)
- **Sort order**: Full relative path using `Intl.Collator` with `numeric: true` (natural sort)
- **Symlink handling**: Skipped during recursive directory traversal via `lstat` checks
- **Backwards compatibility**: Empty MOC result produces no additional output -- no empty headers, no warnings

## Tech Stack

- TypeScript (strict, esnext, ESM)
- Bun runtime
- vitest test runner
- `yaml` npm package (production dependency)
- `node:fs/promises` for filesystem operations
- `node:path` for path manipulation

## File Structure

| File | Responsibility |
|------|---------------|
| `package.json` | **Modify.** Add `yaml` as a production dependency. |
| `src/lib/discover-mocs.ts` | **Create.** Exports `MocRecord` type and `discoverMocs(basePath: string): Promise<MocRecord[]>` function. Scans top-level directories matching `/^\d{2} /`, recursively walks them for `.md` files, parses YAML frontmatter, filters by `type: moc`, strips frontmatter, sorts by relative path with natural sort. Skips symbolic links. |
| `src/lib/assemble-context.ts` | **Modify.** Import `discoverMocs` and call it after the `.2b/` category loop. For each `MocRecord`, append a `## {relativePath}` section with the stripped body content. |
| `tests/unit/discover-mocs.test.ts` | **Create.** Unit tests for the MOC discovery module: numbered folder matching, recursive traversal, frontmatter parsing/filtering, symlink skipping, natural sort ordering, edge cases. |
| `tests/unit/assemble-context.test.ts` | **Modify.** Add tests verifying MOC content appears after `.2b/` content, frontmatter is stripped, and empty MOC result leaves output unchanged. |
| `tests/integration/moc-discovery-and-assembly.integration.test.ts` | **Create.** Integration tests from the Gherkin scenarios -- verifies MOC discovery, ordering, frontmatter stripping, filtering, and backwards compatibility via CLI subprocess. |

## Wave Isolation

| Wave | Tasks | Files | Parallel-safe | Reason |
|------|-------|-------|---------------|--------|
| 0 | T0 | tests/integration/moc-discovery-and-assembly.integration.test.ts | n/a | single task |
| 1 | T1, T2 | T1: package.json, bun.lock / T2: src/lib/discover-mocs.ts, tests/unit/discover-mocs.test.ts | no | T2 imports `yaml` package that T1 installs; T1 must complete before T2 tests can run |
| 2 | T3 | **src/lib/assemble-context.ts**, **tests/unit/assemble-context.test.ts** | n/a | single task |
| 3 | T4 | tests/integration/moc-discovery-and-assembly.integration.test.ts | n/a | single task (GREEN verification) |

---

## Tasks

### Task 0: Integration Test (RED)

**Wave:** 0
**Depends on:** -

Write the integration test file that exercises MOC discovery and assembly via the CLI as a subprocess. These tests will FAIL because the MOC discovery module does not yet exist and `assembleContext` does not yet call it. They encode the Gherkin scenarios from the feature plan.

**Files:**
- Create: `tests/integration/moc-discovery-and-assembly.integration.test.ts`

- [x] **Step 1: Create the integration test file**

Create `tests/integration/moc-discovery-and-assembly.integration.test.ts` with the following content. This file invokes the CLI entry point as a Bun subprocess and asserts MOC files are discovered, ordered correctly, have frontmatter stripped, and appear after `.2b/` content.

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
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

function parseContent(stdout: string): string {
  const json = JSON.parse(stdout);
  return json.hookSpecificOutput.additionalContext as string;
}

const MOC_FRONTMATTER = `---\ntype: moc\n---\n`;

describe("MOC file discovery and context assembly (integration)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-moc-test-"));
    await createDotTwoBDirs(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("MOC files from numbered top-level folders are included in session context", async () => {
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "overview.md"),
      `${MOC_FRONTMATTER}\n# Project Overview\n\nThis is the project MOC.`
    );

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const content = parseContent(stdout);
    expect(content).toContain("# Project Overview");
    expect(content).toContain("This is the project MOC.");
    expect(content).toContain("## 10 Projects/overview.md");
  });

  it("MOC files appear after .2b/ category content in the assembled context", async () => {
    await writeFile(join(tmpDir, ".2b/system/persona.md"), "System persona.");
    await writeFile(join(tmpDir, ".2b/concepts/arch.md"), "Architecture concepts.");

    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "overview.md"),
      `${MOC_FRONTMATTER}\nMOC body content.`
    );

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const content = parseContent(stdout);

    // Date sentence is first
    expect(content).toMatch(/^Today is /);
    const dateIdx = content.indexOf("Today is");
    expect(dateIdx).toBe(0);

    // .2b/ content appears after date
    const systemIdx = content.indexOf("## .2b/system/persona.md");
    const conceptsIdx = content.indexOf("## .2b/concepts/arch.md");
    expect(systemIdx).toBeGreaterThan(dateIdx);
    expect(conceptsIdx).toBeGreaterThan(systemIdx);

    // MOC content appears after all .2b/ content
    const mocIdx = content.indexOf("## 10 Projects/overview.md");
    expect(mocIdx).toBeGreaterThan(conceptsIdx);
  });

  it("YAML frontmatter is stripped from MOC file content", async () => {
    await mkdir(join(tmpDir, "20 Areas"), { recursive: true });
    await writeFile(
      join(tmpDir, "20 Areas", "life-areas.md"),
      `---\ntype: moc\ntitle: Life Areas\n---\n\nThis is the body of the MOC file.`
    );

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const content = parseContent(stdout);
    expect(content).not.toMatch(/^---/m);
    expect(content).not.toContain("type: moc");
    expect(content).not.toContain("title: Life Areas");
    expect(content).toContain("This is the body of the MOC file.");
  });

  it("MOC files from nested subdirectories are discovered", async () => {
    await mkdir(join(tmpDir, "10 Projects", "subdir"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "subdir", "nested-moc.md"),
      `${MOC_FRONTMATTER}\nNested MOC body.`
    );

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const content = parseContent(stdout);
    expect(content).toContain("Nested MOC body.");
    expect(content).toContain("## 10 Projects/subdir/nested-moc.md");
  });

  it("markdown files without type: moc frontmatter are excluded", async () => {
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "regular-note.md"),
      `---\ntype: note\n---\n\nThis is a regular note.`
    );
    await writeFile(
      join(tmpDir, "10 Projects", "no-frontmatter.md"),
      `# Just a heading\n\nNo frontmatter here.`
    );

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const content = parseContent(stdout);
    expect(content).not.toContain("regular-note.md");
    expect(content).not.toContain("This is a regular note.");
    expect(content).not.toContain("no-frontmatter.md");
    expect(content).not.toContain("No frontmatter here.");
  });

  it("MOC files are sorted by numeric prefix on their full relative path", async () => {
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "index.md"),
      `${MOC_FRONTMATTER}\nProjects MOC.`
    );

    await mkdir(join(tmpDir, "30 Resources"), { recursive: true });
    await writeFile(
      join(tmpDir, "30 Resources", "index.md"),
      `${MOC_FRONTMATTER}\nResources MOC.`
    );

    await mkdir(join(tmpDir, "20 Areas"), { recursive: true });
    await writeFile(
      join(tmpDir, "20 Areas", "index.md"),
      `${MOC_FRONTMATTER}\nAreas MOC.`
    );

    const { stdout, exitCode } = await runCli(tmpDir);
    expect(exitCode).toBe(0);

    const content = parseContent(stdout);
    const projectsIdx = content.indexOf("## 10 Projects/index.md");
    const areasIdx = content.indexOf("## 20 Areas/index.md");
    const resourcesIdx = content.indexOf("## 30 Resources/index.md");

    expect(projectsIdx).toBeGreaterThanOrEqual(0);
    expect(areasIdx).toBeGreaterThan(projectsIdx);
    expect(resourcesIdx).toBeGreaterThan(areasIdx);
  });

  describe("only directories matching the numbered prefix pattern are scanned", () => {
    it("includes MOC files from '10 Projects'", async () => {
      await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
      await writeFile(
        join(tmpDir, "10 Projects", "moc.md"),
        `${MOC_FRONTMATTER}\nIncluded.`
      );

      const { stdout, exitCode } = await runCli(tmpDir);
      expect(exitCode).toBe(0);

      const content = parseContent(stdout);
      expect(content).toContain("## 10 Projects/moc.md");
    });

    it("includes MOC files from '00 Inbox'", async () => {
      await mkdir(join(tmpDir, "00 Inbox"), { recursive: true });
      await writeFile(
        join(tmpDir, "00 Inbox", "moc.md"),
        `${MOC_FRONTMATTER}\nIncluded.`
      );

      const { stdout, exitCode } = await runCli(tmpDir);
      expect(exitCode).toBe(0);

      const content = parseContent(stdout);
      expect(content).toContain("## 00 Inbox/moc.md");
    });

    it("includes MOC files from '99 Archive'", async () => {
      await mkdir(join(tmpDir, "99 Archive"), { recursive: true });
      await writeFile(
        join(tmpDir, "99 Archive", "moc.md"),
        `${MOC_FRONTMATTER}\nIncluded.`
      );

      const { stdout, exitCode } = await runCli(tmpDir);
      expect(exitCode).toBe(0);

      const content = parseContent(stdout);
      expect(content).toContain("## 99 Archive/moc.md");
    });

    it("does not include MOC files from 'Projects' (no numeric prefix)", async () => {
      await mkdir(join(tmpDir, "Projects"), { recursive: true });
      await writeFile(
        join(tmpDir, "Projects", "moc.md"),
        `${MOC_FRONTMATTER}\nExcluded.`
      );

      const { stdout, exitCode } = await runCli(tmpDir);
      expect(exitCode).toBe(0);

      const content = parseContent(stdout);
      expect(content).not.toContain("Projects/moc.md");
    });

    it("does not include MOC files from 'my-notes' (no numeric prefix)", async () => {
      await mkdir(join(tmpDir, "my-notes"), { recursive: true });
      await writeFile(
        join(tmpDir, "my-notes", "moc.md"),
        `${MOC_FRONTMATTER}\nExcluded.`
      );

      const { stdout, exitCode } = await runCli(tmpDir);
      expect(exitCode).toBe(0);

      const content = parseContent(stdout);
      expect(content).not.toContain("my-notes/moc.md");
    });

    it("does not include MOC files from '1 Single Digit' (single digit, not two)", async () => {
      await mkdir(join(tmpDir, "1 Single Digit"), { recursive: true });
      await writeFile(
        join(tmpDir, "1 Single Digit", "moc.md"),
        `${MOC_FRONTMATTER}\nExcluded.`
      );

      const { stdout, exitCode } = await runCli(tmpDir);
      expect(exitCode).toBe(0);

      const content = parseContent(stdout);
      expect(content).not.toContain("1 Single Digit/moc.md");
    });
  });

  describe("backwards compatibility without MOC sources", () => {
    it("workspace without numbered folders produces identical output to pre-feature behavior", async () => {
      await writeFile(join(tmpDir, ".2b/system/persona.md"), "System persona.");
      await writeFile(join(tmpDir, ".2b/concepts/arch.md"), "Architecture.");

      const { stdout, stderr, exitCode } = await runCli(tmpDir);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const content = parseContent(stdout);
      expect(content).toMatch(/^Today is /);
      expect(content).toContain("## .2b/system/persona.md");
      expect(content).toContain("## .2b/concepts/arch.md");
      // No MOC sections
      expect(content).not.toMatch(/## \d{2} /);
    });

    it("numbered folders exist but contain no MOC files", async () => {
      await writeFile(join(tmpDir, ".2b/system/persona.md"), "System persona.");

      await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
      await writeFile(
        join(tmpDir, "10 Projects", "regular-note.md"),
        `---\ntype: note\n---\n\nJust a note.`
      );
      await writeFile(
        join(tmpDir, "10 Projects", "no-frontmatter.md"),
        "No frontmatter here."
      );

      const { stdout, stderr, exitCode } = await runCli(tmpDir);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const content = parseContent(stdout);
      expect(content).toMatch(/^Today is /);
      expect(content).toContain("## .2b/system/persona.md");
      expect(content).not.toContain("10 Projects");
    });

    it("empty numbered folders produce no MOC section and no errors", async () => {
      await writeFile(join(tmpDir, ".2b/system/persona.md"), "System persona.");

      await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
      // Directory exists but is empty

      const { stdout, stderr, exitCode } = await runCli(tmpDir);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");

      const content = parseContent(stdout);
      expect(content).toMatch(/^Today is /);
      expect(content).toContain("## .2b/system/persona.md");
      expect(content).not.toContain("10 Projects");
    });
  });
});
```

- [x] **Step 2: Run the integration tests to verify they fail**

Run: `bunx vitest run tests/integration/moc-discovery-and-assembly.integration.test.ts`
Expected: FAIL -- the CLI does not yet discover MOC files, so assertions like `toContain("## 10 Projects/overview.md")` will fail. The backwards-compatibility tests may pass since the feature does not exist yet, but the MOC inclusion tests will fail.

- [x] **Step 3: Commit**

```bash
git add tests/integration/moc-discovery-and-assembly.integration.test.ts
git commit -m "test(moc-discovery): add integration tests for MOC discovery and assembly (RED)"
```

---

### Task 1: Add yaml Production Dependency

**Wave:** 1
**Depends on:** -

Add the `yaml` npm package as a production dependency. This package is used by the MOC discovery module to parse YAML frontmatter from markdown files.

**Files:**
- Modify: `package.json`

- [x] **Step 1: Install the yaml package**

Run: `bun add yaml`

This updates `package.json` to add `yaml` under `dependencies` and updates `bun.lock`.

- [x] **Step 2: Verify the dependency was added**

Run: `cat package.json`
Expected: The `dependencies` section contains `"yaml": "^2.x.x"` (exact minor version depends on latest available).

- [x] **Step 3: Verify the package resolves**

Run: `bun run -e "import { parse } from 'yaml'; console.log(typeof parse)"`
Expected: Output is `function`.

- [x] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "deps: add yaml package for YAML frontmatter parsing"
```

---

### Task 2: MOC Discovery Module

**Wave:** 1
**Depends on:** -

A pure async function that accepts a base path and returns an ordered list of MOC file records. Each record contains the relative path and body content (frontmatter stripped).

**Files:**
- Create: `src/lib/discover-mocs.ts`
- Create: `tests/unit/discover-mocs.test.ts`

- [x] **Step 1: Write the failing tests**

Create `tests/unit/discover-mocs.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverMocs } from "../../src/lib/discover-mocs.js";
import type { MocRecord } from "../../src/lib/discover-mocs.js";

describe("discoverMocs", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-moc-discover-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty array when no top-level directories match the pattern", async () => {
    await mkdir(join(tmpDir, "Projects"), { recursive: true });
    await mkdir(join(tmpDir, "my-notes"), { recursive: true });

    const result = await discoverMocs(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns an empty array when matched directories contain no markdown files", async () => {
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(join(tmpDir, "10 Projects", "readme.txt"), "Not markdown.");

    const result = await discoverMocs(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns an empty array when matched directories are empty", async () => {
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });

    const result = await discoverMocs(tmpDir);
    expect(result).toEqual([]);
  });

  it("discovers a MOC file with type: moc frontmatter", async () => {
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "overview.md"),
      "---\ntype: moc\n---\n\nProject overview body."
    );

    const result = await discoverMocs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].relativePath).toBe("10 Projects/overview.md");
    expect(result[0].body).toBe("\nProject overview body.");
  });

  it("strips full YAML frontmatter including extra fields", async () => {
    await mkdir(join(tmpDir, "20 Areas"), { recursive: true });
    await writeFile(
      join(tmpDir, "20 Areas", "life.md"),
      "---\ntype: moc\ntitle: Life Areas\ntags:\n  - area\n  - moc\n---\n\nLife areas body."
    );

    const result = await discoverMocs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe("\nLife areas body.");
    expect(result[0].body).not.toContain("type: moc");
    expect(result[0].body).not.toContain("title:");
    expect(result[0].body).not.toContain("---");
  });

  it("excludes files without frontmatter", async () => {
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "plain.md"),
      "# Just a heading\n\nNo frontmatter here."
    );

    const result = await discoverMocs(tmpDir);
    expect(result).toEqual([]);
  });

  it("excludes files with frontmatter but type is not moc", async () => {
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "note.md"),
      "---\ntype: note\n---\n\nA regular note."
    );

    const result = await discoverMocs(tmpDir);
    expect(result).toEqual([]);
  });

  it("excludes files with frontmatter but no type field", async () => {
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "no-type.md"),
      "---\ntitle: Something\n---\n\nNo type field."
    );

    const result = await discoverMocs(tmpDir);
    expect(result).toEqual([]);
  });

  it("discovers MOC files in nested subdirectories", async () => {
    await mkdir(join(tmpDir, "10 Projects", "subproject", "deep"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "subproject", "deep", "nested-moc.md"),
      "---\ntype: moc\n---\n\nDeeply nested MOC."
    );

    const result = await discoverMocs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].relativePath).toBe("10 Projects/subproject/deep/nested-moc.md");
    expect(result[0].body).toBe("\nDeeply nested MOC.");
  });

  it("skips symbolic links during traversal", async () => {
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "real-moc.md"),
      "---\ntype: moc\n---\n\nReal MOC."
    );

    // Create a symlink pointing to the same directory (circular reference)
    await mkdir(join(tmpDir, "10 Projects", "subdir"), { recursive: true });
    await symlink(
      join(tmpDir, "10 Projects"),
      join(tmpDir, "10 Projects", "subdir", "loop-link")
    );

    const result = await discoverMocs(tmpDir);
    // Should only find the real file, not follow the symlink
    expect(result).toHaveLength(1);
    expect(result[0].relativePath).toBe("10 Projects/real-moc.md");
  });

  it("sorts by full relative path with natural/numeric sort", async () => {
    await mkdir(join(tmpDir, "30 Resources"), { recursive: true });
    await writeFile(
      join(tmpDir, "30 Resources", "index.md"),
      "---\ntype: moc\n---\n\nResources."
    );

    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "index.md"),
      "---\ntype: moc\n---\n\nProjects."
    );

    await mkdir(join(tmpDir, "20 Areas"), { recursive: true });
    await writeFile(
      join(tmpDir, "20 Areas", "index.md"),
      "---\ntype: moc\n---\n\nAreas."
    );

    const result = await discoverMocs(tmpDir);
    expect(result).toHaveLength(3);
    expect(result[0].relativePath).toBe("10 Projects/index.md");
    expect(result[1].relativePath).toBe("20 Areas/index.md");
    expect(result[2].relativePath).toBe("30 Resources/index.md");
  });

  it("excludes directories not matching the two-digit-space pattern", async () => {
    // Only two-digit prefix with space matches
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "moc.md"),
      "---\ntype: moc\n---\n\nIncluded."
    );

    // Single digit -- excluded
    await mkdir(join(tmpDir, "1 Single"), { recursive: true });
    await writeFile(
      join(tmpDir, "1 Single", "moc.md"),
      "---\ntype: moc\n---\n\nExcluded single digit."
    );

    // Three digits -- excluded
    await mkdir(join(tmpDir, "100 TooMany"), { recursive: true });
    await writeFile(
      join(tmpDir, "100 TooMany", "moc.md"),
      "---\ntype: moc\n---\n\nExcluded three digits."
    );

    // No space after digits -- excluded
    await mkdir(join(tmpDir, "10Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10Projects", "moc.md"),
      "---\ntype: moc\n---\n\nExcluded no space."
    );

    // No digits -- excluded
    await mkdir(join(tmpDir, "Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "Projects", "moc.md"),
      "---\ntype: moc\n---\n\nExcluded no digits."
    );

    const result = await discoverMocs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].relativePath).toBe("10 Projects/moc.md");
  });

  it("handles type: moc with quoted value", async () => {
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "quoted.md"),
      '---\ntype: "moc"\n---\n\nQuoted type value.'
    );

    const result = await discoverMocs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].relativePath).toBe("10 Projects/quoted.md");
    expect(result[0].body).toBe("\nQuoted type value.");
  });

  it("discovers multiple MOC files across multiple directories and depths", async () => {
    await mkdir(join(tmpDir, "00 Inbox"), { recursive: true });
    await writeFile(
      join(tmpDir, "00 Inbox", "inbox-moc.md"),
      "---\ntype: moc\n---\n\nInbox MOC."
    );

    await mkdir(join(tmpDir, "10 Projects", "active"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "active", "project-moc.md"),
      "---\ntype: moc\n---\n\nActive project MOC."
    );

    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "overview.md"),
      "---\ntype: moc\n---\n\nProjects overview."
    );

    const result = await discoverMocs(tmpDir);
    expect(result).toHaveLength(3);
    expect(result[0].relativePath).toBe("00 Inbox/inbox-moc.md");
    expect(result[1].relativePath).toBe("10 Projects/active/project-moc.md");
    expect(result[2].relativePath).toBe("10 Projects/overview.md");
  });

  it("ignores non-markdown files in matched directories", async () => {
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(join(tmpDir, "10 Projects", "data.yaml"), "type: moc");
    await writeFile(join(tmpDir, "10 Projects", "notes.txt"), "---\ntype: moc\n---");
    await writeFile(
      join(tmpDir, "10 Projects", "real-moc.md"),
      "---\ntype: moc\n---\n\nReal MOC."
    );

    const result = await discoverMocs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].relativePath).toBe("10 Projects/real-moc.md");
  });

  it("returns an empty array when base path has no top-level directories at all", async () => {
    // tmpDir is empty except for .2b which doesn't match the pattern
    const result = await discoverMocs(tmpDir);
    expect(result).toEqual([]);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/unit/discover-mocs.test.ts`
Expected: FAIL with "Cannot find module" or "Module not found" because `src/lib/discover-mocs.ts` does not exist yet.

- [x] **Step 3: Write the implementation**

Create `src/lib/discover-mocs.ts`:

```typescript
import { readdir, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface MocRecord {
  relativePath: string;
  body: string;
}

const NUMBERED_DIR_PATTERN = /^\d{2} /;

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export async function discoverMocs(basePath: string): Promise<MocRecord[]> {
  const topEntries = await readdir(basePath, { withFileTypes: true });

  const numberedDirs = topEntries.filter(
    (entry) => entry.isDirectory() && NUMBERED_DIR_PATTERN.test(entry.name)
  );

  const records: MocRecord[] = [];

  for (const dir of numberedDirs) {
    const dirPath = join(basePath, dir.name);
    const mdFiles = await walkForMarkdown(dirPath);

    for (const absolutePath of mdFiles) {
      const content = await readFile(absolutePath, "utf-8");
      const parsed = parseFrontmatter(content);

      if (parsed === null) {
        continue;
      }

      if (parsed.frontmatter.type !== "moc") {
        continue;
      }

      const relativePath = absolutePath.slice(basePath.length + 1);
      records.push({ relativePath, body: parsed.body });
    }
  }

  records.sort((a, b) => collator.compare(a.relativePath, b.relativePath));

  return records;
}

async function walkForMarkdown(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    const stats = await lstat(fullPath);
    if (stats.isSymbolicLink()) {
      continue;
    }

    if (stats.isDirectory()) {
      const nested = await walkForMarkdown(fullPath);
      results.push(...nested);
    } else if (entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results;
}

interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

function parseFrontmatter(content: string): ParsedFrontmatter | null {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return null;
  }

  const endIndex = content.indexOf("\n---\n", 4);
  const endIndexCr = content.indexOf("\r\n---\r\n", 5);

  let fmEnd: number;
  let delimiterLength: number;

  if (endIndex !== -1 && (endIndexCr === -1 || endIndex < endIndexCr)) {
    fmEnd = endIndex;
    delimiterLength = 4; // length of "\n---\n"
  } else if (endIndexCr !== -1) {
    fmEnd = endIndexCr;
    delimiterLength = 6; // length of "\r\n---\r\n"
  } else {
    return null;
  }

  const yamlStr = content.slice(4, fmEnd);
  const body = content.slice(fmEnd + delimiterLength);

  try {
    const parsed = parseYaml(yamlStr);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return { frontmatter: parsed as Record<string, unknown>, body };
  } catch {
    return null;
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/unit/discover-mocs.test.ts`
Expected: All 16 tests PASS.

Note: This task depends on the `yaml` package being installed (Task 1). If running in parallel-safe mode, ensure `bun add yaml` has completed before running these tests. If the `yaml` import fails, run `bun add yaml` first.

- [x] **Step 5: Commit**

```bash
git add src/lib/discover-mocs.ts tests/unit/discover-mocs.test.ts
git commit -m "feat(moc-discovery): add MOC discovery module with unit tests"
```

---

### Task 3: Integrate MOC Sections into Context Assembly

**Wave:** 2
**Depends on:** Task 1, Task 2

Modify `assembleContext` to call `discoverMocs` after the `.2b/` category loop and append MOC sections to the output. Update the existing unit tests to verify MOC integration behavior.

**Files:**
- Modify: `src/lib/assemble-context.ts`
- Modify: `tests/unit/assemble-context.test.ts`

- [x] **Step 1: Add MOC integration unit tests**

Append the following tests to the existing `describe("assembleContext", ...)` block at the end of `tests/unit/assemble-context.test.ts`, before the final closing `});`:

```typescript
  it("includes MOC content after .2b/ category content", async () => {
    await writeFile(join(tmpDir, ".2b/system/persona.md"), "System content.");

    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "overview.md"),
      "---\ntype: moc\n---\n\nProject overview body."
    );

    const result = await assembleContext(tmpDir, FIXED_NOW);

    const systemIdx = result.indexOf("## .2b/system/persona.md");
    const mocIdx = result.indexOf("## 10 Projects/overview.md");

    expect(systemIdx).toBeGreaterThanOrEqual(0);
    expect(mocIdx).toBeGreaterThan(systemIdx);
    expect(result).toContain("Project overview body.");
  });

  it("strips frontmatter from MOC file content in assembled output", async () => {
    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "overview.md"),
      "---\ntype: moc\ntitle: Projects\n---\n\nProject overview body."
    );

    const result = await assembleContext(tmpDir, FIXED_NOW);

    expect(result).toContain("## 10 Projects/overview.md");
    expect(result).toContain("Project overview body.");
    expect(result).not.toContain("type: moc");
    expect(result).not.toContain("title: Projects");
  });

  it("leaves output unchanged when no MOC files exist", async () => {
    await writeFile(join(tmpDir, ".2b/system/persona.md"), "System content.");

    const result = await assembleContext(tmpDir, FIXED_NOW);

    expect(result).toContain("## .2b/system/persona.md");
    expect(result).toContain("System content.");
    // No MOC headers should appear
    const lines = result.split("\n");
    const mocHeaders = lines.filter((l) => l.startsWith("## ") && !l.startsWith("## .2b/"));
    expect(mocHeaders).toHaveLength(0);
  });

  it("leaves output unchanged when numbered dirs exist but contain no MOC files", async () => {
    await writeFile(join(tmpDir, ".2b/system/persona.md"), "System content.");

    await mkdir(join(tmpDir, "10 Projects"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "note.md"),
      "---\ntype: note\n---\n\nRegular note."
    );

    const result = await assembleContext(tmpDir, FIXED_NOW);

    expect(result).toContain("## .2b/system/persona.md");
    const lines = result.split("\n");
    const mocHeaders = lines.filter((l) => l.startsWith("## ") && !l.startsWith("## .2b/"));
    expect(mocHeaders).toHaveLength(0);
  });

  it("MOC sections use ## relative/path header format", async () => {
    await mkdir(join(tmpDir, "10 Projects", "sub"), { recursive: true });
    await writeFile(
      join(tmpDir, "10 Projects", "sub", "nested.md"),
      "---\ntype: moc\n---\n\nNested body."
    );

    const result = await assembleContext(tmpDir, FIXED_NOW);

    expect(result).toContain("## 10 Projects/sub/nested.md");
    const headerIdx = result.indexOf("## 10 Projects/sub/nested.md");
    const afterHeader = result.slice(headerIdx + "## 10 Projects/sub/nested.md".length).trimStart();
    expect(afterHeader.startsWith("Nested body.")).toBe(true);
  });
```

- [x] **Step 2: Run updated tests to verify the new tests fail**

Run: `bunx vitest run tests/unit/assemble-context.test.ts`
Expected: The 5 new tests FAIL because `assembleContext` does not yet call `discoverMocs`. The existing 10 tests should still PASS.

- [x] **Step 3: Modify assembleContext to integrate MOC discovery**

Replace the entire contents of `src/lib/assemble-context.ts` with:

```typescript
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatDateSentence } from "./format-date.js";
import { discoverMocs } from "./discover-mocs.js";

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

  const mocRecords = await discoverMocs(basePath);
  for (const moc of mocRecords) {
    sections.push(`## ${moc.relativePath}\n\n${moc.body}`);
  }

  if (sections.length === 0) {
    return dateSentence;
  }

  return dateSentence + "\n\n" + sections.join("\n\n");
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/unit/assemble-context.test.ts`
Expected: All 15 tests PASS (10 existing + 5 new).

- [x] **Step 5: Run all unit tests to verify no regressions**

Run: `bunx vitest run tests/unit/`
Expected: All unit tests PASS (format-date: 12, assemble-context: 15, discover-mocs: 16, hook-output: 4, validate-dirs: 5 = 52 total).

- [x] **Step 6: Commit**

```bash
git add src/lib/assemble-context.ts tests/unit/assemble-context.test.ts
git commit -m "feat(moc-discovery): integrate MOC sections into context assembly"
```

---

### Task 4: Integration Tests GREEN

**Wave:** 3
**Depends on:** Task 0, Task 3

Run the integration tests written in Task 0. They should now pass because MOC discovery is integrated into the assembly pipeline. Also run the full test suite to verify no regressions.

**Files:**
- (No file changes expected -- this is a verification task)

- [x] **Step 1: Run the MOC integration tests**

Run: `bunx vitest run tests/integration/moc-discovery-and-assembly.integration.test.ts`
Expected: All 16 integration tests PASS.

- [x] **Step 2: Run all integration tests together**

Run: `bunx vitest run tests/integration/`
Expected: All integration tests PASS (existing session-start: 9, existing date-injection: 4, new MOC: 16 = 29 total).

- [x] **Step 3: Run the full test suite**

Run: `bunx vitest run`
Expected: All tests PASS (52 unit + 29 integration = 81 total).

- [x] **Step 4: Commit (only if adjustments were needed)**

```bash
git add -A
git commit -m "test(moc-discovery): integration tests GREEN"
```

---

## Acceptance Criteria Traceability

| Acceptance Criterion | Task(s) |
|---|---|
| `yaml` package added as a production dependency | T1 |
| MOC discovery module recursively scans top-level directories matching `/^\d{2} /` for `.md` files with `type: moc` YAML frontmatter | T2 |
| Symbolic links are skipped during recursive directory traversal | T2 |
| YAML frontmatter is stripped from MOC file content before inclusion in output | T2, T3 |
| MOC file sections use `## relative/path/to/file.md` headers consistent with `.2b/` file headers | T3, T0/T4 |
| MOC files are sorted by numeric prefix on their full relative path (natural sort) | T2, T0/T4 |
| MOC content appears after all `.2b/` category content in assembled output | T3, T0/T4 |
| When no numbered directories or MOC files exist, output is identical to pre-feature behavior with no errors or warnings | T2, T3, T0/T4 |
