import { FabricClient } from "../client/fabric-client.js";
import { logger } from "../utils/logger.js";
import type { PaginatedResponse } from "./types.js";

const COMPONENT = "Pagination";

export async function paginateAll<T>(
  client: FabricClient,
  path: string,
  resultKey: string = "value"
): Promise<T[]> {
  const all: T[] = [];
  let currentPath: string | null = path;
  let pageCount = 0;

  while (currentPath) {
    pageCount++;
    const isFullUrl = currentPath.startsWith("http");
    const response = isFullUrl
      ? await client.getFullUrl<Record<string, unknown>>(currentPath)
      : await client.get<Record<string, unknown>>(currentPath);

    const data = response.data;
    const items = (data[resultKey] as T[]) ?? [];
    all.push(...items);

    logger.debug(COMPONENT, `Page ${pageCount} for ${path}`, {
      itemsThisPage: items.length,
      totalSoFar: all.length,
    });

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

  logger.debug(COMPONENT, `Pagination complete for ${path}`, {
    totalPages: pageCount,
    totalItems: all.length,
  });

  return all;
}
