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
// DD: zero-padded two digits, YYYY: four digits, HH:mm: 24-hour, TZ: letter followed by letters, digits, +, or -
const DATE_SENTENCE_REGEX =
  /^Today is (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) \d{2}, \d{4} at ([01]\d|2[0-3]):\d{2} [A-Z][A-Z0-9+\-]*\.$/;

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
    // Timezone abbreviation (letter followed by letters, digits, +, or - before the period)
    expect(firstLine).toMatch(/[A-Z][A-Z0-9+\-]*\.$/);

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
