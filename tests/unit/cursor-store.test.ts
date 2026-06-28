import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCursorStore, saveCursorStore, type CursorStore } from "../../src/lib/cursor-store.js";

describe("cursor-store", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-cursors-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty map when the file is missing", async () => {
    const store = await loadCursorStore(tmpDir);
    expect(store).toEqual({});
  });

  it("loads an existing well-formed cursor map", async () => {
    await mkdir(join(tmpDir, ".2b", "state"), { recursive: true });
    const initial: CursorStore = {
      "sess-1": { transcript_path: "/x/y", byte_offset: 42, last_updated_iso: "2026-06-28T00:00:00.000Z" },
    };
    await writeFile(join(tmpDir, ".2b", "state", "cursors.json"), JSON.stringify(initial));

    const store = await loadCursorStore(tmpDir);
    expect(store).toEqual(initial);
  });

  it("returns an empty map when the file is malformed", async () => {
    await mkdir(join(tmpDir, ".2b", "state"), { recursive: true });
    await writeFile(join(tmpDir, ".2b", "state", "cursors.json"), "{not json");

    const store = await loadCursorStore(tmpDir);
    expect(store).toEqual({});
  });

  it("saves the cursor map atomically and round-trips through load", async () => {
    const next: CursorStore = {
      "sess-1": { transcript_path: "/p", byte_offset: 100, last_updated_iso: "2026-06-28T01:00:00.000Z" },
      "sess-2": { transcript_path: "/q", byte_offset: 200, last_updated_iso: "2026-06-28T02:00:00.000Z" },
    };
    await saveCursorStore(tmpDir, next);

    const onDisk = JSON.parse(await readFile(join(tmpDir, ".2b", "state", "cursors.json"), "utf-8"));
    expect(onDisk).toEqual(next);

    const reloaded = await loadCursorStore(tmpDir);
    expect(reloaded).toEqual(next);
  });

  it("creates .2b/state/ on first save when missing", async () => {
    await saveCursorStore(tmpDir, { "s": { transcript_path: "/t", byte_offset: 0, last_updated_iso: "x" } });
    const onDisk = await readFile(join(tmpDir, ".2b", "state", "cursors.json"), "utf-8");
    expect(JSON.parse(onDisk)).toMatchObject({ s: { byte_offset: 0 } });
  });
});
