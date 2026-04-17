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
