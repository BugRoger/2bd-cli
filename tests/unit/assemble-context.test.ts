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
      /^Today is (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) \d{2}, \d{4} at ([01]\d|2[0-3]):\d{2} [A-Z0-9+\-]+\./
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
