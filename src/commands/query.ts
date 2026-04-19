import { validateDirs } from "../lib/validate-dirs.js";
import { discoverMocs } from "../lib/discover-mocs.js";
import type { MocRecord } from "../lib/discover-mocs.js";
import { execSync } from "node:child_process";

interface ValidateOptions {
  whichFn?: (cmd: string) => Promise<string | null>;
}

async function defaultWhich(cmd: string): Promise<string | null> {
  try {
    // Try Bun.which first if available
    if (typeof Bun !== "undefined" && Bun.which) {
      const path = Bun.which(cmd);
      if (path) return path;
    }
  } catch {
    // Fall through to Node's which command
  }

  try {
    // Fall back to Node's which command
    const result = execSync(`which ${cmd}`, { encoding: "utf-8" });
    return result.trim() || null;
  } catch {
    return null;
  }
}

export async function validateQueryPrereqs(
  cwd: string,
  options?: ValidateOptions
): Promise<string | null> {
  const whichFn = options?.whichFn ?? defaultWhich;

  const dirError = await validateDirs(cwd);
  if (dirError !== null) {
    return dirError;
  }

  const claudePath = await whichFn("claude");
  if (claudePath === null) {
    return 'The "claude" CLI is not available on PATH. Install it from https://docs.anthropic.com/en/docs/claude-code';
  }

  const mocs = await discoverMocs(cwd);
  if (mocs.length === 0) {
    return "No MOC files found. Create at least one markdown file with \"type: moc\" YAML frontmatter in a numbered top-level directory (e.g., \"10 Projects/\").";
  }

  return null;
}

export function buildSystemPrompt(fileBack?: string): string {
  let prompt = `You are a vault research assistant. Your job is to answer the user's question by reading documents from their Obsidian vault.

## Citation format

- Use Obsidian wikilink syntax for citations: [[path/to/document]]
- Do NOT include the .md file extension in wikilink paths — write [[10 Projects/testing]], not [[10 Projects/testing.md]]
- Cite every source document you reference

## Output format

- Return clean, raw markdown suitable for piping to other tools
- No decorative output, no progress indicators, no status messages
- Structure your response with clear headings and bullet points where appropriate`;

  if (fileBack !== undefined) {
    prompt += `

## File-back mode

You are in file-back mode. Write your response to the file at path: ${fileBack}

Use the Write tool to create this file. The file must be a valid Obsidian vault note with YAML frontmatter containing these fields:
- title: A descriptive title for the note
- type: "query-result"
- tags: Relevant tags as a YAML list
- created: Current date in YYYY-MM-DD format
- updated: Current date in YYYY-MM-DD format

After the frontmatter, write the full response body with citations.
Do NOT write the response to stdout — write it to the file only.`;
  }

  return prompt;
}

export function buildMainPrompt(
  mocRecords: MocRecord[],
  question: string
): string {
  const sections: string[] = [];

  if (mocRecords.length > 0) {
    sections.push("# Vault Index (MOC Files)\n");
    sections.push(
      "The following are Maps of Content (MOC) files from the vault. Use them as an index to find relevant documents to read.\n"
    );
    for (const moc of mocRecords) {
      sections.push(`## ${moc.relativePath}\n${moc.body}`);
    }
  }

  sections.push("# Question\n");
  sections.push(question);

  return sections.join("\n");
}

export function buildToolList(fileBack?: string): string {
  if (fileBack !== undefined && fileBack.length > 0) {
    return "Read,Glob,Grep,Write,Edit";
  }
  return "Read,Glob,Grep";
}

export async function queryAction(
  question: string,
  options: { fileBack?: string }
): Promise<void> {
  const cwd = process.cwd();

  const validationError = await validateQueryPrereqs(cwd);
  if (validationError !== null) {
    process.stderr.write(`Error: ${validationError}\n`);
    process.exit(1);
  }

  const mocs = await discoverMocs(cwd);

  const systemPrompt = buildSystemPrompt(options.fileBack);
  const mainPrompt = buildMainPrompt(mocs, question);
  const toolList = buildToolList(options.fileBack);

  const args = [
    "-p",
    mainPrompt,
    "--append-system-prompt",
    systemPrompt,
    "--allowedTools",
    toolList,
  ];

  const proc = Bun.spawn(["claude", ...args], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutReader = proc.stdout.getReader();
  while (true) {
    const { done, value } = await stdoutReader.read();
    if (done) break;
    process.stdout.write(value);
  }

  const stderrReader = proc.stderr.getReader();
  while (true) {
    const { done, value } = await stderrReader.read();
    if (done) break;
    process.stderr.write(value);
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
