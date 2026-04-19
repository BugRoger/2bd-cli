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

    const result = await validateQueryPrereqs(tmpDir);
    expect(result).not.toBeNull();
    expect(result).toMatch(/moc/i);
  });

  it("checks .2b/ before claude CLI", async () => {
    const result = await validateQueryPrereqs(tmpDir);
    expect(result).not.toBeNull();
    expect(result).toMatch(/\.2b/);
    expect(result).not.toMatch(/claude/i);
  });

  it("checks claude CLI before MOC discovery", async () => {
    await mkdir(join(tmpDir, ".2b", "system"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "concepts"), { recursive: true });
    await mkdir(join(tmpDir, ".2b", "instructions"), { recursive: true });

    const result = await validateQueryPrereqs(tmpDir, {
      whichFn: async () => null,
    });
    expect(result).not.toBeNull();
    expect(result).toMatch(/claude/i);
  });
});
