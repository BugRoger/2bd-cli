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
