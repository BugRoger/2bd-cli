import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendTurnsToDailyLog, dailyLogPath } from "../../src/lib/daily-log.js";

describe("daily-log", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-dailylog-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("dailyLogPath", () => {
    it("resolves to .2b/state/sessions/YYYY-MM-DD.jsonl using the local calendar date", () => {
      const fixedNow = new Date(2026, 5, 28, 23, 59, 0); // local: 2026-06-28
      const path = dailyLogPath(tmpDir, fixedNow);
      expect(path).toBe(join(tmpDir, ".2b", "state", "sessions", "2026-06-28.jsonl"));
    });

    it("pads single-digit month and day with leading zeros", () => {
      const fixedNow = new Date(2026, 0, 3, 12, 0, 0); // local: 2026-01-03
      expect(dailyLogPath(tmpDir, fixedNow)).toContain("2026-01-03.jsonl");
    });
  });

  describe("appendTurnsToDailyLog", () => {
    it("appends one JSONL line per turn with ts, session_id, role, content", async () => {
      const fixedNow = new Date(2026, 5, 28, 9, 0, 0);
      await appendTurnsToDailyLog(
        tmpDir,
        [
          { role: "user", content: "q" },
          { role: "assistant", content: "a" },
        ],
        { session_id: "sess-1", now: fixedNow }
      );

      const path = dailyLogPath(tmpDir, fixedNow);
      const lines = (await readFile(path, "utf-8")).split("\n").filter((l) => l.length > 0);
      expect(lines.length).toBe(2);
      const e0 = JSON.parse(lines[0]);
      const e1 = JSON.parse(lines[1]);
      expect(e0).toMatchObject({ session_id: "sess-1", role: "user", content: "q" });
      expect(e1).toMatchObject({ session_id: "sess-1", role: "assistant", content: "a" });
      expect(typeof e0.ts).toBe("string");
      expect(e0.ts).toBe(fixedNow.toISOString());
    });

    it("creates .2b/state/sessions/ lazily on first append", async () => {
      const fixedNow = new Date(2026, 5, 28, 9, 0, 0);
      await appendTurnsToDailyLog(
        tmpDir,
        [{ role: "assistant", content: "first" }],
        { session_id: "s", now: fixedNow }
      );
      const path = dailyLogPath(tmpDir, fixedNow);
      const body = await readFile(path, "utf-8");
      expect(body).toContain("first");
    });

    it("appends to existing content without overwriting", async () => {
      const fixedNow = new Date(2026, 5, 28, 9, 0, 0);
      const path = dailyLogPath(tmpDir, fixedNow);
      await mkdir(join(tmpDir, ".2b", "state", "sessions"), { recursive: true });
      const existing = JSON.stringify({ ts: "old", session_id: "s0", role: "assistant", content: "old" }) + "\n";
      await writeFile(path, existing);

      await appendTurnsToDailyLog(
        tmpDir,
        [{ role: "assistant", content: "new" }],
        { session_id: "s", now: fixedNow }
      );

      const lines = (await readFile(path, "utf-8")).split("\n").filter((l) => l.length > 0);
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]).content).toBe("old");
      expect(JSON.parse(lines[1]).content).toBe("new");
    });

    it("is a no-op when given an empty turns array", async () => {
      const fixedNow = new Date(2026, 5, 28, 9, 0, 0);
      await appendTurnsToDailyLog(tmpDir, [], { session_id: "s", now: fixedNow });
      const path = dailyLogPath(tmpDir, fixedNow);
      // file should not exist
      let exists = true;
      try {
        await readFile(path);
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    });

    it("preserves multi-line content via JSON escaping", async () => {
      const fixedNow = new Date(2026, 5, 28, 9, 0, 0);
      await appendTurnsToDailyLog(
        tmpDir,
        [{ role: "assistant", content: "line1\nline2\nline3" }],
        { session_id: "s", now: fixedNow }
      );
      const path = dailyLogPath(tmpDir, fixedNow);
      const lines = (await readFile(path, "utf-8")).split("\n").filter((l) => l.length > 0);
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]).content).toBe("line1\nline2\nline3");
    });
  });
});
