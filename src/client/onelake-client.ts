import { TokenManager } from "../auth/token-manager.js";
import { FabricApiError } from "../core/errors.js";
import { logger, safeHeaders } from "../utils/logger.js";

/**
 * OneLake Data Access API — the ADLS Gen2-compatible REST surface for reading/writing
 * files inside a Fabric item's "Files" (or "Tables") folder. This is a distinct API
 * surface from the Fabric REST API (api.fabric.microsoft.com): paths are addressed as
 * /{workspaceId}/{itemId}/{path}, and it authenticates with the Azure Storage resource
 * scope rather than the Fabric scope.
 */
const ONELAKE_BASE_URL = "https://onelake.dfs.fabric.microsoft.com";
const DFS_API_VERSION = "2023-11-03";
const COMPONENT = "OneLakeClient";

// Append in chunks to stay well under service-side per-request limits for large uploads.
const APPEND_CHUNK_BYTES = 4 * 1024 * 1024;

export interface OneLakePathItem {
  name: string;
  isDirectory?: boolean;
  contentLength?: string;
  lastModified?: string;
  etag?: string;
  owner?: string;
  group?: string;
  permissions?: string;
}

export interface OneLakePathProperties {
  contentLength?: string;
  lastModified?: string;
  etag?: string;
  resourceType?: string;
  contentType?: string;
}

function encodeOneLakePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

function itemPathUrl(workspaceId: string, itemId: string, path: string): string {
  const encoded = encodeOneLakePath(`${itemId}/${path}`);
  return `${ONELAKE_BASE_URL}/${encodeURIComponent(workspaceId)}/${encoded}`;
}

export class OneLakeClient {
  constructor(private tokenManager: TokenManager) {}

  private async getHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
    const token = await this.tokenManager.getOneLakeToken();
    return {
      Authorization: `Bearer ${token}`,
      "x-ms-version": DFS_API_VERSION,
      ...extra,
    };
  }

  private async throwForError(response: Response, method: string, url: string): Promise<never> {
    const requestId = response.headers.get("x-ms-request-id") ?? undefined;
    let errorMessage = response.statusText;
    let errorCode: string | undefined;

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await response.json().catch(() => undefined)) as
        | { error?: { code?: string; message?: string } }
        | undefined;
      if (body?.error) {
        errorMessage = body.error.message ?? errorMessage;
        errorCode = body.error.code;
      }
    } else {
      const text = await response.text().catch(() => undefined);
      if (text) errorMessage = text;
    }

    logger.error(COMPONENT, `API error on ${method} ${url}`, {
      status: response.status,
      errorCode,
      errorMessage,
      requestId,
    });

    throw new FabricApiError(errorMessage, response.status, errorCode, undefined, requestId);
  }

  private logResponse(response: Response, method: string, url: string, startTime: number): void {
    logger.debug(COMPONENT, `${method} ${url} completed`, {
      status: response.status,
      durationMs: Date.now() - startTime,
      requestId: response.headers.get("x-ms-request-id") ?? undefined,
    });
    if (logger.isDebug()) {
      logger.debug(COMPONENT, "Response headers", safeHeaders(response.headers));
    }
  }

  /** List files/folders under a directory path within an item (e.g. "Files" or "Files/sub"). */
  async listPaths(workspaceId: string, itemId: string, directory: string, recursive: boolean): Promise<OneLakePathItem[]> {
    const results: OneLakePathItem[] = [];
    let continuation: string | undefined;

    do {
      const url = new URL(`${ONELAKE_BASE_URL}/${encodeURIComponent(workspaceId)}`);
      url.searchParams.set("resource", "filesystem");
      url.searchParams.set("directory", `${itemId}/${directory}`.replace(/\/+$/, ""));
      url.searchParams.set("recursive", String(recursive));
      if (continuation) url.searchParams.set("continuation", continuation);

      logger.debug(COMPONENT, `GET ${url.toString()}`);
      const startTime = Date.now();
      const headers = await this.getHeaders();
      const response = await fetch(url, { headers });
      this.logResponse(response, "GET", url.toString(), startTime);

      if (!response.ok) {
        await this.throwForError(response, "GET", url.toString());
      }

      const body = (await response.json()) as { paths?: Array<Record<string, string>> };
      for (const p of body.paths ?? []) {
        results.push({
          name: p.name,
          isDirectory: p.isDirectory === "true",
          contentLength: p.contentLength,
          lastModified: p.lastModified,
          etag: p.etag,
          owner: p.owner,
          group: p.group,
          permissions: p.permissions,
        });
      }

      continuation = response.headers.get("x-ms-continuation") ?? undefined;
    } while (continuation);

    return results;
  }

  /** Get metadata (size, last modified, etag, resource type) for a file or folder. */
  async getProperties(workspaceId: string, itemId: string, path: string): Promise<OneLakePathProperties> {
    const url = itemPathUrl(workspaceId, itemId, path);
    logger.debug(COMPONENT, `HEAD ${url}`);
    const startTime = Date.now();
    const headers = await this.getHeaders();
    const response = await fetch(url, { method: "HEAD", headers });
    this.logResponse(response, "HEAD", url, startTime);

    if (!response.ok) {
      await this.throwForError(response, "HEAD", url);
    }

    return {
      contentLength: response.headers.get("content-length") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
      etag: response.headers.get("etag") ?? undefined,
      resourceType: response.headers.get("x-ms-resource-type") ?? undefined,
      contentType: response.headers.get("content-type") ?? undefined,
    };
  }

  /** Create an empty directory (folder marker). */
  async createDirectory(workspaceId: string, itemId: string, path: string): Promise<void> {
    const url = `${itemPathUrl(workspaceId, itemId, path)}?resource=directory`;
    logger.debug(COMPONENT, `PUT ${url}`);
    const startTime = Date.now();
    const headers = await this.getHeaders({ "Content-Length": "0" });
    const response = await fetch(url, { method: "PUT", headers });
    this.logResponse(response, "PUT", url, startTime);

    if (!response.ok) {
      await this.throwForError(response, "PUT", url);
    }
  }

  /** Upload (create + append + flush) a file's contents. */
  async uploadFile(workspaceId: string, itemId: string, path: string, content: Buffer, overwrite: boolean): Promise<void> {
    const createUrl = `${itemPathUrl(workspaceId, itemId, path)}?resource=file`;
    logger.debug(COMPONENT, `PUT ${createUrl}`, { bodyBytes: content.byteLength, overwrite });
    const createStart = Date.now();
    const createHeaders = await this.getHeaders({ "Content-Length": "0" });
    if (!overwrite) {
      createHeaders["If-None-Match"] = "*";
    }
    const createResponse = await fetch(createUrl, { method: "PUT", headers: createHeaders });
    this.logResponse(createResponse, "PUT", createUrl, createStart);

    if (!createResponse.ok) {
      if (createResponse.status === 409 && !overwrite) {
        throw new FabricApiError(
          `A file already exists at "${path}". Set overwrite=true to replace it.`,
          409,
          "PathAlreadyExists"
        );
      }
      await this.throwForError(createResponse, "PUT", createUrl);
    }

    let position = 0;
    while (position < content.byteLength) {
      const chunk = content.subarray(position, position + APPEND_CHUNK_BYTES);
      const appendUrl = `${itemPathUrl(workspaceId, itemId, path)}?action=append&position=${position}`;
      logger.debug(COMPONENT, `PATCH ${appendUrl}`, { chunkBytes: chunk.byteLength });
      const appendStart = Date.now();
      const appendHeaders = await this.getHeaders({ "Content-Type": "application/octet-stream" });
      const appendResponse = await fetch(appendUrl, { method: "PATCH", headers: appendHeaders, body: chunk as BodyInit });
      this.logResponse(appendResponse, "PATCH", appendUrl, appendStart);

      if (!appendResponse.ok) {
        await this.throwForError(appendResponse, "PATCH", appendUrl);
      }
      position += chunk.byteLength;
    }

    const flushUrl = `${itemPathUrl(workspaceId, itemId, path)}?action=flush&position=${content.byteLength}`;
    logger.debug(COMPONENT, `PATCH ${flushUrl}`);
    const flushStart = Date.now();
    const flushHeaders = await this.getHeaders({ "Content-Length": "0" });
    const flushResponse = await fetch(flushUrl, { method: "PATCH", headers: flushHeaders });
    this.logResponse(flushResponse, "PATCH", flushUrl, flushStart);

    if (!flushResponse.ok) {
      await this.throwForError(flushResponse, "PATCH", flushUrl);
    }
  }

  /** Download a file's raw bytes. */
  async downloadFile(workspaceId: string, itemId: string, path: string): Promise<Buffer> {
    const url = itemPathUrl(workspaceId, itemId, path);
    logger.debug(COMPONENT, `GET ${url}`);
    const startTime = Date.now();
    const headers = await this.getHeaders();
    const response = await fetch(url, { headers });
    this.logResponse(response, "GET", url, startTime);

    if (!response.ok) {
      await this.throwForError(response, "GET", url);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /** Delete a file, or a folder (recursive=true deletes non-empty folders). */
  async deletePath(workspaceId: string, itemId: string, path: string, recursive: boolean): Promise<void> {
    const url = `${itemPathUrl(workspaceId, itemId, path)}?recursive=${recursive}`;
    logger.debug(COMPONENT, `DELETE ${url}`);
    const startTime = Date.now();
    const headers = await this.getHeaders();
    const response = await fetch(url, { method: "DELETE", headers });
    this.logResponse(response, "DELETE", url, startTime);

    if (!response.ok) {
      await this.throwForError(response, "DELETE", url);
    }
  }

  /** Move/rename a file or folder within the same workspace/item. */
  async movePath(workspaceId: string, itemId: string, sourcePath: string, destinationPath: string): Promise<void> {
    const destinationUrl = itemPathUrl(workspaceId, itemId, destinationPath);
    const renameSource = `/${encodeOneLakePath(`${workspaceId}/${itemId}/${sourcePath}`)}`;
    logger.debug(COMPONENT, `PUT ${destinationUrl}`, { renameSource });
    const startTime = Date.now();
    const headers = await this.getHeaders({
      "x-ms-rename-source": renameSource,
      "Content-Length": "0",
    });
    const response = await fetch(destinationUrl, { method: "PUT", headers });
    this.logResponse(response, "PUT", destinationUrl, startTime);

    if (!response.ok) {
      await this.throwForError(response, "PUT", destinationUrl);
    }
  }
}
