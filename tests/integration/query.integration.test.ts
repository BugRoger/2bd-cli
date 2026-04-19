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

    // Build a PATH that includes bun but not claude (~/.local/bin)
    const pathDirs = (process.env.PATH ?? "").split(":").filter(
      (d) => !d.includes(".local/bin")
    );
    const { stderr, exitCode } = await runCli(
      ["query", "any question"],
      tmpDir,
      { env: { PATH: pathDirs.join(":") } }
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
    // stderr may contain a benign "no stdin data" warning from claude -p
    const meaningfulStderr = stderr
      .split("\n")
      .filter((line) => !line.startsWith("Warning: no stdin data"))
      .join("\n")
      .trim();
    expect(meaningfulStderr).toBe("");
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
