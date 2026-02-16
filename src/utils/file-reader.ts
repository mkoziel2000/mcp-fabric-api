import { readFile, readdir, stat } from "fs/promises";
import { resolve, relative, extname } from "path";

export interface FileEntry {
  path: string;
  content: string;
}

export async function readContentFromFile(filePath: string): Promise<string> {
  const absolutePath = resolve(filePath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error(`Path is not a file: ${absolutePath}`);
  }
  return readFile(absolutePath, "utf-8");
}

export async function readFilesFromDirectory(
  dirPath: string,
  extensions?: string[]
): Promise<FileEntry[]> {
  const absolutePath = resolve(dirPath);
  const dirStat = await stat(absolutePath);
  if (!dirStat.isDirectory()) {
    throw new Error(`Path is not a directory: ${absolutePath}`);
  }

  const entries: FileEntry[] = [];
  const lowerExtensions = extensions?.map((e) => e.toLowerCase());

  async function walk(dir: string): Promise<void> {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = resolve(dir, item.name);
      if (item.isDirectory()) {
        await walk(fullPath);
      } else if (item.isFile()) {
        if (lowerExtensions && !lowerExtensions.includes(extname(item.name).toLowerCase())) {
          continue;
        }
        const relPath = relative(absolutePath, fullPath).replace(/\\/g, "/");
        const content = await readFile(fullPath, "utf-8");
        entries.push({ path: relPath, content });
      }
    }
  }

  await walk(absolutePath);

  if (entries.length === 0) {
    const filterMsg = extensions ? ` matching extensions: ${extensions.join(", ")}` : "";
    throw new Error(`No files found in directory: ${absolutePath}${filterMsg}`);
  }

  return entries;
}

export async function resolveContentOrFile(
  content: string | undefined,
  filePath: string | undefined,
  fieldName: string
): Promise<string> {
  if (content && filePath) {
    throw new Error(`Provide either '${fieldName}' or '${fieldName}FilePath', not both`);
  }
  if (filePath) {
    return readContentFromFile(filePath);
  }
  if (content) {
    return content;
  }
  throw new Error(`Either '${fieldName}' or '${fieldName}FilePath' must be provided`);
}

export async function resolveFilesOrDirectory(
  files: FileEntry[] | undefined,
  dirPath: string | undefined,
  extensions?: string[]
): Promise<FileEntry[]> {
  if (files && files.length > 0 && dirPath) {
    throw new Error("Provide either 'files' or a directory path, not both");
  }
  if (dirPath) {
    return readFilesFromDirectory(dirPath, extensions);
  }
  if (files && files.length > 0) {
    return files;
  }
  throw new Error("Either 'files' or a directory path must be provided");
}
