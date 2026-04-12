import { validateDirs } from "../lib/validate-dirs.js";
import { assembleContext } from "../lib/assemble-context.js";
import { buildHookOutput } from "../lib/hook-output.js";

export async function sessionStartAction(): Promise<void> {
  const cwd = process.cwd();

  const validationError = await validateDirs(cwd);
  if (validationError !== null) {
    process.stderr.write(`Error: ${validationError}\n`);
    process.exit(1);
  }

  const markdown = await assembleContext(cwd);
  const json = buildHookOutput(markdown);

  process.stdout.write(json + "\n");
}
