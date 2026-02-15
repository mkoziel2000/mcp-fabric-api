import { FabricClient } from "../client/fabric-client.js";
import type { PaginatedResponse } from "./types.js";

export async function paginateAll<T>(
  client: FabricClient,
  path: string,
  resultKey: string = "value"
): Promise<T[]> {
  const all: T[] = [];
  let currentPath: string | null = path;

  while (currentPath) {
    const isFullUrl = currentPath.startsWith("http");
    const response = isFullUrl
      ? await client.getFullUrl<Record<string, unknown>>(currentPath)
      : await client.get<Record<string, unknown>>(currentPath);

    const data = response.data;
    const items = (data[resultKey] as T[]) ?? [];
    all.push(...items);

    const continuationUri = data.continuationUri as string | null | undefined;
    const continuationToken = data.continuationToken as string | null | undefined;

    if (continuationUri) {
      currentPath = continuationUri;
    } else if (continuationToken) {
      const separator = path.includes("?") ? "&" : "?";
      currentPath = `${path}${separator}continuationToken=${continuationToken}`;
    } else {
      currentPath = null;
    }
  }

  return all;
}
