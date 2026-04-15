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

    // Date sentence precedes all .2b/ section headers
    expect(content).toMatch(/^Today is /);
    const dateIdx = content.indexOf("Today is");
    expect(dateIdx).toBe(0);
    expect(systemIdx).toBeGreaterThan(dateIdx);
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

    const content: string = json.hookSpecificOutput.additionalContext;
    // With date injection, empty categories still produce the date sentence
    expect(content).toMatch(/^Today is /);
    // No .2b/ headers should be present
    expect(content).not.toContain("## .2b/");
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
