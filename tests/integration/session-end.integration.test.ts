import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../src/cli.ts");

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runSessionEndHook(
  cwd: string,
  stdinPayload: string,
  extraEnv: Record<string, string> = {}
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn("bun", ["run", CLI_PATH, "hooks", "session-end"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    proc.on("error", (err) => reject(err));

    proc.stdin.write(stdinPayload);
    proc.stdin.end();
  });
}

async function createVault(base: string): Promise<void> {
  await mkdir(join(base, ".2b", "system"), { recursive: true });
}

function assistantTurnLine(text: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

async function writeTranscript(path: string, lines: string[]): Promise<void> {
  await writeFile(path, lines.map((l) => l + "\n").join(""));
}

function todayLocalDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear().toString().padStart(4, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dailyLogPath(cwd: string): string {
  return join(cwd, ".2b", "state", "sessions", `${todayLocalDate()}.jsonl`);
}

function cursorsPath(cwd: string): string {
  return join(cwd, ".2b", "state", "cursors.json");
}

function errorLogPath(cwd: string): string {
  return join(cwd, ".2b", "state", "hook-errors.log");
}

async function readJsonlEntries(path: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(path, "utf-8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("CLI integration: hooks session-end — finalize", () => {
  let tmpDir: string;
  let transcriptPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "2bd-session-end-test-"));
    await createVault(tmpDir);
    transcriptPath = join(tmpDir, "transcript.jsonl");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("Scenario: SessionEnd writes a final cursor update for the terminating session", () => {
    it("finalizes the cursor with the post-flush byte offset and refreshed timestamp", async () => {
      await writeTranscript(transcriptPath, [
        assistantTurnLine("turn-1"),
        assistantTurnLine("turn-2"),
      ]);

      const payload = JSON.stringify({ session_id: "sess-final", transcript_path: transcriptPath });
      const { exitCode } = await runSessionEndHook(tmpDir, payload);
      expect(exitCode).toBe(0);

      const cursors = JSON.parse(await readFile(cursorsPath(tmpDir), "utf-8"));
      expect(cursors["sess-final"]).toBeDefined();
      expect(cursors["sess-final"].transcript_path).toBe(transcriptPath);
      expect(cursors["sess-final"].byte_offset).toBeGreaterThan(0);
      expect(typeof cursors["sess-final"].last_updated_iso).toBe("string");
      expect((cursors["sess-final"].last_updated_iso as string).length).toBeGreaterThan(0);
    });
  });

  describe("Scenario: SessionEnd emits a session-end marker into today's daily log", () => {
    it("appends a marker line {ts, session_id, role:'session-end'} with no content field", async () => {
      await writeTranscript(transcriptPath, [assistantTurnLine("only turn")]);

      const payload = JSON.stringify({ session_id: "sess-marker", transcript_path: transcriptPath });
      const { exitCode } = await runSessionEndHook(tmpDir, payload);
      expect(exitCode).toBe(0);

      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      // Last line must be the marker. Captured turn (if any) precedes it.
      const last = entries[entries.length - 1];
      expect(last.role).toBe("session-end");
      expect(last.session_id).toBe("sess-marker");
      expect(typeof last.ts).toBe("string");
      expect((last.ts as string).length).toBeGreaterThan(0);
      expect("content" in last).toBe(false);
    });

    it("appends the marker after any captured turns from the final flush", async () => {
      await writeTranscript(transcriptPath, [
        assistantTurnLine("before-end-1"),
        assistantTurnLine("before-end-2"),
      ]);

      const payload = JSON.stringify({ session_id: "sess-order", transcript_path: transcriptPath });
      const { exitCode } = await runSessionEndHook(tmpDir, payload);
      expect(exitCode).toBe(0);

      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      // Order: turn-1, turn-2, marker
      expect(entries.length).toBe(3);
      expect(entries[0]).toMatchObject({ role: "assistant", content: "before-end-1" });
      expect(entries[1]).toMatchObject({ role: "assistant", content: "before-end-2" });
      expect(entries[2]).toMatchObject({ role: "session-end", session_id: "sess-order" });
    });
  });

  describe("Scenario: SessionEnd creates the state area lazily if no Stop hook ran first", () => {
    it("lazily creates .2b/state/sessions/ and writes the marker with no prior cursor", async () => {
      await writeTranscript(transcriptPath, [assistantTurnLine("first ever")]);
      expect(await fileExists(join(tmpDir, ".2b", "state"))).toBe(false);

      const payload = JSON.stringify({ session_id: "sess-lazy", transcript_path: transcriptPath });
      const { exitCode } = await runSessionEndHook(tmpDir, payload);
      expect(exitCode).toBe(0);

      expect(await fileExists(join(tmpDir, ".2b", "state"))).toBe(true);
      expect(await fileExists(dailyLogPath(tmpDir))).toBe(true);
      expect(await fileExists(cursorsPath(tmpDir))).toBe(true);

      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      const markers = entries.filter((e) => e.role === "session-end");
      expect(markers.length).toBe(1);
      expect(markers[0].session_id).toBe("sess-lazy");
    });
  });

  describe("Scenario: SessionEnd short-circuits when the recursion guard is set", () => {
    it("does nothing and exits 0 when TWOBD_HOOK_DISABLED=1", async () => {
      await writeTranscript(transcriptPath, [assistantTurnLine("should be ignored")]);

      const payload = JSON.stringify({ session_id: "sess-guard", transcript_path: transcriptPath });
      const { exitCode } = await runSessionEndHook(tmpDir, payload, { TWOBD_HOOK_DISABLED: "1" });

      expect(exitCode).toBe(0);
      expect(await fileExists(dailyLogPath(tmpDir))).toBe(false);
      expect(await fileExists(cursorsPath(tmpDir))).toBe(false);
      expect(await fileExists(errorLogPath(tmpDir))).toBe(false);
    });
  });

  describe("Scenario: SessionEnd errors are logged and never break the session", () => {
    it("logs and exits 0 when transcript_path points to a missing file", async () => {
      const missing = join(tmpDir, "does-not-exist.jsonl");
      const payload = JSON.stringify({ session_id: "sess-missing", transcript_path: missing });
      const { exitCode } = await runSessionEndHook(tmpDir, payload);
      expect(exitCode).toBe(0);
      expect(await fileExists(errorLogPath(tmpDir))).toBe(true);

      // The marker must still be written even when the transcript read failed.
      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      const markers = entries.filter((e) => e.role === "session-end");
      expect(markers.length).toBe(1);
      expect(markers[0].session_id).toBe("sess-missing");
    });

    it("writes the marker even when transcript_path is omitted from the payload", async () => {
      const payload = JSON.stringify({ session_id: "sess-no-transcript" });
      const { exitCode } = await runSessionEndHook(tmpDir, payload);
      expect(exitCode).toBe(0);

      const entries = await readJsonlEntries(dailyLogPath(tmpDir));
      const markers = entries.filter((e) => e.role === "session-end");
      expect(markers.length).toBe(1);
      expect(markers[0].session_id).toBe("sess-no-transcript");
    });
  });

  describe("Scenario: SessionEnd with a malformed payload does not break the session", () => {
    it("exits 0 and writes a parse-error entry to hook-errors.log", async () => {
      const { exitCode } = await runSessionEndHook(tmpDir, "this is not json");
      expect(exitCode).toBe(0);
      expect(await fileExists(errorLogPath(tmpDir))).toBe(true);
      const errs = await readFile(errorLogPath(tmpDir), "utf-8");
      expect(errs.length).toBeGreaterThan(0);
      // No marker should have been written for an unidentifiable session.
      expect(await fileExists(dailyLogPath(tmpDir))).toBe(false);
    });

    it("exits 0 and logs when session_id is missing", async () => {
      const payload = JSON.stringify({ transcript_path: "/tmp/whatever.jsonl" });
      const { exitCode } = await runSessionEndHook(tmpDir, payload);
      expect(exitCode).toBe(0);
      expect(await fileExists(errorLogPath(tmpDir))).toBe(true);
      expect(await fileExists(dailyLogPath(tmpDir))).toBe(false);
    });
  });
});
