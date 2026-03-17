import { TokenManager } from "../auth/token-manager.js";
import { FabricApiError } from "../core/errors.js";
import { logger, safeHeaders } from "../utils/logger.js";

const POWERBI_BASE_URL = "https://api.powerbi.com/v1.0/myorg";
const COMPONENT = "PowerBIClient";

export interface PowerBIResponse<T = unknown> {
  data: T;
  status: number;
}

export class PowerBIClient {
  constructor(private tokenManager: TokenManager) {}

  private async getHeaders(): Promise<Record<string, string>> {
    const token = await this.tokenManager.getPowerBIToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  private async handleResponse<T>(
    response: Response,
    method: string,
    url: string,
    startTime: number
  ): Promise<PowerBIResponse<T>> {
    const durationMs = Date.now() - startTime;
    const requestId = response.headers.get("requestid") ?? response.headers.get("x-ms-request-id") ?? undefined;

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

    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return { data: undefined as T, status: response.status };
    }

    let body: unknown;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    if (!response.ok) {
      const err = body as Record<string, unknown>;
      const errorBody = (err?.error ?? err) as Record<string, unknown>;
      const errorMessage = (errorBody?.message as string) ?? response.statusText;
      const errorCode = (errorBody?.errorCode as string) ?? undefined;
      const errorDetails = (errorBody?.details as unknown[]) ?? undefined;

      logger.error(COMPONENT, `API error on ${method} ${url}`, {
        status: response.status,
        errorCode,
        errorMessage,
        requestId,
        details: errorDetails,
        innerError: errorBody?.innererror,
        durationMs,
      });

      throw new FabricApiError(
        errorMessage,
        response.status,
        errorCode,
        undefined,
        requestId,
        errorDetails
      );
    }

    return { data: body as T, status: response.status };
  }

  async get<T = unknown>(path: string): Promise<PowerBIResponse<T>> {
    const url = `${POWERBI_BASE_URL}${path}`;
    logger.debug(COMPONENT, `GET ${url}`);
    const startTime = Date.now();
    const headers = await this.getHeaders();
    const response = await fetch(url, { headers });
    return this.handleResponse<T>(response, "GET", url, startTime);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<PowerBIResponse<T>> {
    const url = `${POWERBI_BASE_URL}${path}`;
    logger.debug(COMPONENT, `POST ${url}`, body !== undefined ? { bodyBytes: JSON.stringify(body).length } : undefined);
    const startTime = Date.now();
    const headers = await this.getHeaders();
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(response, "POST", url, startTime);
  }

  async delete<T = unknown>(path: string): Promise<PowerBIResponse<T>> {
    const url = `${POWERBI_BASE_URL}${path}`;
    logger.debug(COMPONENT, `DELETE ${url}`);
    const startTime = Date.now();
    const headers = await this.getHeaders();
    const response = await fetch(url, {
      method: "DELETE",
      headers,
    });
    return this.handleResponse<T>(response, "DELETE", url, startTime);
  }
}
