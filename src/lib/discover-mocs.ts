import { readdir, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface MocRecord {
  relativePath: string;
  body: string;
}

const NUMBERED_DIR_PATTERN = /^\d{2} /;

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export async function discoverMocs(basePath: string): Promise<MocRecord[]> {
  const topEntries = await readdir(basePath, { withFileTypes: true });

  const numberedDirs = topEntries.filter(
    (entry) => entry.isDirectory() && NUMBERED_DIR_PATTERN.test(entry.name)
  );

  const records: MocRecord[] = [];

  for (const dir of numberedDirs) {
    const dirPath = join(basePath, dir.name);
    const mdFiles = await walkForMarkdown(dirPath);

    for (const absolutePath of mdFiles) {
      const content = await readFile(absolutePath, "utf-8");
      const parsed = parseFrontmatter(content);

      if (parsed === null) {
        continue;
      }

      if (parsed.frontmatter.type !== "moc") {
        continue;
      }

      const relativePath = absolutePath.slice(basePath.length + 1);
      records.push({ relativePath, body: parsed.body });
    }
  }

  records.sort((a, b) => collator.compare(a.relativePath, b.relativePath));

  return records;
}

async function walkForMarkdown(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    const stats = await lstat(fullPath);
    if (stats.isSymbolicLink()) {
      continue;
    }

    if (stats.isDirectory()) {
      const nested = await walkForMarkdown(fullPath);
      results.push(...nested);
    } else if (entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results;
}

interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

function parseFrontmatter(content: string): ParsedFrontmatter | null {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return null;
  }

  const endIndex = content.indexOf("\n---\n", 4);
  const endIndexCr = content.indexOf("\r\n---\r\n", 5);

  let fmEnd: number;
  let bodyStart: number;

  if (endIndex !== -1 && (endIndexCr === -1 || endIndex < endIndexCr)) {
    fmEnd = endIndex;
    bodyStart = endIndex + 5; // length of "\n---\n"
  } else if (endIndexCr !== -1) {
    fmEnd = endIndexCr;
    bodyStart = endIndexCr + 7; // length of "\r\n---\r\n"
  } else {
    return null;
  }

  const yamlStr = content.slice(4, fmEnd);
  const body = content.slice(bodyStart);

  try {
    const parsed = parseYaml(yamlStr);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return { frontmatter: parsed as Record<string, unknown>, body };
  } catch {
    return null;
  }
}
