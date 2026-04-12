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
