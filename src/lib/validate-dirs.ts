import { stat } from "node:fs/promises";
import { join } from "node:path";

const REQUIRED_SUBDIRS = ["system"] as const;

export async function validateDirs(basePath: string): Promise<string | null> {
  const dotTwoBPath = join(basePath, ".2b");

  const dotTwoBExists = await dirExists(dotTwoBPath);
  if (!dotTwoBExists) {
    return `Required directory ".2b/" not found in ${basePath}`;
  }

  for (const subdir of REQUIRED_SUBDIRS) {
    const subdirPath = join(dotTwoBPath, subdir);
    const exists = await dirExists(subdirPath);
    if (!exists) {
      return `Required directory ".2b/${subdir}/" not found in ${basePath}`;
    }
  }

  return null;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}
