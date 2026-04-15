import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatDateSentence } from "./format-date.js";

const CATEGORIES = ["system", "concepts", "instructions"] as const;

export async function assembleContext(basePath: string, now?: Date): Promise<string> {
  const dateSentence = formatDateSentence(now);
  const sections: string[] = [];

  for (const category of CATEGORIES) {
    const categoryDir = join(basePath, ".2b", category);
    const entries = await readdir(categoryDir);

    const mdFiles = entries
      .filter((entry) => entry.endsWith(".md"))
      .sort();

    for (const file of mdFiles) {
      const filePath = join(categoryDir, file);
      const content = await readFile(filePath, "utf-8");
      const relativePath = `.2b/${category}/${file}`;
      sections.push(`## ${relativePath}\n\n${content}`);
    }
  }

  if (sections.length === 0) {
    return dateSentence;
  }

  return dateSentence + "\n\n" + sections.join("\n\n");
}
