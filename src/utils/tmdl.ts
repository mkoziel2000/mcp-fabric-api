export interface TmdlFile {
  path: string;
  content: string;
}

export interface DefinitionPart {
  path: string;
  payload: string;
  payloadType: string;
}

export function decodeTmdlParts(parts: DefinitionPart[]): TmdlFile[] {
  return parts.map((part) => ({
    path: part.path,
    content:
      part.payloadType === "InlineBase64"
        ? Buffer.from(part.payload, "base64").toString("utf-8")
        : part.payload,
  }));
}

export function encodeTmdlParts(files: TmdlFile[]): DefinitionPart[] {
  return files.map((file) => ({
    path: file.path,
    payload: Buffer.from(file.content, "utf-8").toString("base64"),
    payloadType: "InlineBase64",
  }));
}

export function formatTmdlOutput(files: TmdlFile[]): string {
  return files
    .map((file) => `--- ${file.path} ---\n${file.content}`)
    .join("\n\n");
}
