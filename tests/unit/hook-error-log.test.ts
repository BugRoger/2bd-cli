import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logHookError } from "../../src/lib/hook-error-log.js";

describe("logHookError", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-errlog-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("appends a line to .2b/state/hook-errors.log with timestamp and message", async () => {
    const fixedNow = new Date("2026-06-28T12:34:56.000Z");
    await logHookError(tmpDir, "boom", undefined, { now: fixedNow });

    const body = await readFile(join(tmpDir, ".2b", "state", "hook-errors.log"), "utf-8");
    expect(body).toContain("2026-06-28T12:34:56.000Z");
    expect(body).toContain("boom");
    expect(body.endsWith("\n")).toBe(true);
  });

  it("appends context fields as key=value pairs", async () => {
    const fixedNow = new Date("2026-06-28T12:34:56.000Z");
    await logHookError(tmpDir, "missing transcript", { session_id: "abc", transcript_path: "/x/y" }, { now: fixedNow });

    const body = await readFile(join(tmpDir, ".2b", "state", "hook-errors.log"), "utf-8");
    expect(body).toContain("session_id=abc");
    expect(body).toContain("transcript_path=/x/y");
  });

  it("appends — does not overwrite — when called multiple times", async () => {
    const fixedNow = new Date("2026-06-28T12:34:56.000Z");
    await logHookError(tmpDir, "first", undefined, { now: fixedNow });
    await logHookError(tmpDir, "second", undefined, { now: fixedNow });

    const body = await readFile(join(tmpDir, ".2b", "state", "hook-errors.log"), "utf-8");
    const lines = body.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("second");
  });

  it("lazily creates .2b/state/ when missing", async () => {
    const fixedNow = new Date("2026-06-28T12:34:56.000Z");
    await logHookError(tmpDir, "create-me", undefined, { now: fixedNow });
    const s = await stat(join(tmpDir, ".2b", "state"));
    expect(s.isDirectory()).toBe(true);
  });

  it("never throws when the target directory is unwritable", async () => {
    // Point cwd at a path that cannot be created (parent is a file)
    const blocker = join(tmpDir, "blocker");
    await import("node:fs/promises").then((m) => m.writeFile(blocker, "x"));
    // logHookError must swallow any error
    await expect(logHookError(blocker, "should-not-throw")).resolves.toBeUndefined();
  });
});
