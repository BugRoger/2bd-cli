import { describe, it, expect } from "vitest";
import { buildHookOutput } from "../../src/lib/hook-output.js";

describe("buildHookOutput", () => {
  it("wraps content in the hook JSON contract", () => {
    const result = buildHookOutput("Some markdown content.");
    const json = JSON.parse(result);

    expect(json).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "Some markdown content.",
      },
    });
  });

  it("produces valid JSON", () => {
    const result = buildHookOutput("Content with \"quotes\" and \nnewlines.");
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("handles empty string content", () => {
    const result = buildHookOutput("");
    const json = JSON.parse(result);

    expect(json.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(json.hookSpecificOutput.additionalContext).toBe("");
  });

  it("preserves the exact content string without modification", () => {
    const content = "## .2b/system/persona.md\n\nYou are helpful.\n\n## .2b/concepts/arch.md\n\nMicroservices.";
    const result = buildHookOutput(content);
    const json = JSON.parse(result);

    expect(json.hookSpecificOutput.additionalContext).toBe(content);
  });
});
