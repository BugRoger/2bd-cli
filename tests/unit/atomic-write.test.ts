import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atomicWriteFile } from "../../src/lib/atomic-write.js";

describe("atomicWriteFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-atomic-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes the given contents to the target path", async () => {
    const target = join(tmpDir, "out.txt");
    await atomicWriteFile(target, "hello\n");
    const body = await readFile(target, "utf-8");
    expect(body).toBe("hello\n");
  });

  it("creates the parent directory if it does not exist", async () => {
    const target = join(tmpDir, "deep", "nested", "out.txt");
    await atomicWriteFile(target, "x");
    const body = await readFile(target, "utf-8");
    expect(body).toBe("x");
  });

  it("overwrites an existing file atomically", async () => {
    const target = join(tmpDir, "out.txt");
    await writeFile(target, "old");
    await atomicWriteFile(target, "new");
    expect(await readFile(target, "utf-8")).toBe("new");
  });

  it("leaves no .tmp.* files after a successful write", async () => {
    const target = join(tmpDir, "out.txt");
    await atomicWriteFile(target, "clean");
    const entries = await readdir(tmpDir);
    expect(entries.some((e) => e.includes(".tmp."))).toBe(false);
  });

  it("supports concurrent writes to the same path without throwing", async () => {
    const target = join(tmpDir, "out.txt");
    const ops = Array.from({ length: 10 }, (_, i) => atomicWriteFile(target, `value-${i}\n`));
    await Promise.all(ops);
    const body = await readFile(target, "utf-8");
    expect(body).toMatch(/^value-\d+\n$/);
  });
});
