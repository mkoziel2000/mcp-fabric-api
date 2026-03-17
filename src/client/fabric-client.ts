import { TokenManager } from "../auth/token-manager.js";
import { FabricApiError } from "../core/errors.js";
import { logger, safeHeaders, summarizeDefinitionParts } from "../utils/logger.js";

const FABRIC_BASE_URL = "https://api.fabric.microsoft.com/v1";
const COMPONENT = "FabricClient";

export interface LroResult {
  operationId: string;
  location?: string;
  retryAfter?: number;
}

export interface FabricResponse<T = unknown> {
  data: T;
  lro?: LroResult;
  status: number;
}

export class FabricClient {
  constructor(private tokenManager: TokenManager) {}

  private async getHeaders(): Promise<Record<string, string>> {
    const token = await this.tokenManager.getFabricToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  private extractLro(response: Response): LroResult | undefined {
    if (response.status !== 202) return undefined;
    const operationId =
      response.headers.get("x-ms-operation-id") ??
      response.headers.get("location")?.match(/operations\/([^/?]+)/)?.[1];
    if (!operationId) return undefined;
    const retryAfter = response.headers.get("retry-after");
    return {
      operationId,
      location: response.headers.get("location") ?? undefined,
      retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
    };
  }

  private async handleResponse<T>(
    response: Response,
    method: string,
    url: string,
    startTime: number
  ): Promise<FabricResponse<T>> {
    const durationMs = Date.now() - startTime;
    const requestId = response.headers.get("x-ms-request-id") ?? undefined;

    logger.debug(COMPONENT, `${method} ${url} completed`, {
      status: response.status,
      durationMs,
      requestId,
    });

    if (logger.isDebug()) {
      logger.debug(COMPONENT, "Response headers", safeHeaders(response.headers));
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 30000;
      logger.warn(COMPONENT, `Rate limited on ${method} ${url}`, { retryAfterSecs: waitMs / 1000, requestId });
      throw new FabricApiError(
        `Rate limited. Retry after ${waitMs / 1000}s`,
        429,
        "TooManyRequests",
        undefined,
        requestId
      );
    }

    const lro = this.extractLro(response);

    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return { data: undefined as T, lro, status: response.status };
    }

    let body: unknown;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    if (!response.ok && response.status !== 202) {
      const err = body as Record<string, unknown>;
      const errorBody = (err?.error ?? err) as Record<string, unknown>;
      const errorMessage = (errorBody?.message as string) ?? response.statusText;
      const errorCode = (errorBody?.errorCode as string) ?? undefined;
      const relatedResource = (errorBody?.relatedResource as string) ?? undefined;
      const errorDetails = (errorBody?.details as unknown[]) ?? undefined;

      logger.error(COMPONENT, `API error on ${method} ${url}`, {
        status: response.status,
        errorCode,
        errorMessage,
        relatedResource,
        requestId,
        details: errorDetails,
        innerError: errorBody?.innererror,
        durationMs,
      });

      throw new FabricApiError(
        errorMessage,
        response.status,
        errorCode,
        relatedResource,
        requestId,
        errorDetails
      );
    }

    if (lro) {
      logger.debug(COMPONENT, `LRO initiated from ${method} ${url}`, {
        operationId: lro.operationId,
        location: lro.location,
        requestId,
      });
    }

    return { data: body as T, lro, status: response.status };
  }

  async get<T = unknown>(path: string): Promise<FabricResponse<T>> {
    const url = `${FABRIC_BASE_URL}${path}`;
    logger.debug(COMPONENT, `GET ${url}`);
    const startTime = Date.now();
    const headers = await this.getHeaders();
    const response = await fetch(url, { headers });
    return this.handleResponse<T>(response, "GET", url, startTime);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<FabricResponse<T>> {
    const url = `${FABRIC_BASE_URL}${path}`;
    const debugMeta: Record<string, unknown> = {};
    if (body !== undefined) {
      debugMeta.bodyBytes = JSON.stringify(body).length;
      // Auto-detect definition uploads and log part structure (no payload content)
      const bodyObj = body as Record<string, unknown>;
      const def = bodyObj?.definition as Record<string, unknown> | undefined;
      if (def?.parts && Array.isArray(def.parts)) {
        debugMeta.definitionParts = summarizeDefinitionParts(
          def.parts as Array<{ path: string; payload: string; payloadType: string }>
        );
      }
    }
    logger.debug(COMPONENT, `POST ${url}`, Object.keys(debugMeta).length > 0 ? debugMeta : undefined);
    const startTime = Date.now();
    const headers = await this.getHeaders();
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(response, "POST", url, startTime);
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<FabricResponse<T>> {
    const url = `${FABRIC_BASE_URL}${path}`;
    logger.debug(COMPONENT, `PATCH ${url}`, { bodyBytes: JSON.stringify(body).length });
    const startTime = Date.now();
    const headers = await this.getHeaders();
    const response = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(response, "PATCH", url, startTime);
  }

  async delete<T = unknown>(path: string): Promise<FabricResponse<T>> {
    const url = `${FABRIC_BASE_URL}${path}`;
    logger.debug(COMPONENT, `DELETE ${url}`);
    const startTime = Date.now();
    const headers = await this.getHeaders();
    const response = await fetch(url, {
      method: "DELETE",
      headers,
    });
    return this.handleResponse<T>(response, "DELETE", url, startTime);
  }

  async getFullUrl<T = unknown>(url: string): Promise<FabricResponse<T>> {
    logger.debug(COMPONENT, `GET ${url}`);
    const startTime = Date.now();
    const headers = await this.getHeaders();
    const response = await fetch(url, { headers });
    return this.handleResponse<T>(response, "GET", url, startTime);
  }
}
