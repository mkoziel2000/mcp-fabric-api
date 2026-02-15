export function encodeBase64(content: string): string {
  return Buffer.from(content, "utf-8").toString("base64");
}

export function decodeBase64(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf-8");
}
