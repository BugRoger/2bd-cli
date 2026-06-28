import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

let counter = 0;

export async function atomicWriteFile(target: string, contents: string): Promise<void> {
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });

  counter += 1;
  const tmpPath = `${target}.tmp.${process.pid}.${counter}`;

  await writeFile(tmpPath, contents);
  await rename(tmpPath, target);
}
