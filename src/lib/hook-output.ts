interface HookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

export function buildHookOutput(additionalContext: string): string {
  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
  };
  return JSON.stringify(output);
}
