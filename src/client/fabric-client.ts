import { TokenManager } from "../auth/token-manager.js";
import { FabricApiError } from "../core/errors.js";

const FABRIC_BASE_URL = "https://api.fabric.microsoft.com/v1";

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

  private async handleResponse<T>(response: Response): Promise<FabricResponse<T>> {
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 30000;
      throw new FabricApiError(
        `Rate limited. Retry after ${waitMs / 1000}s`,
        429,
        "TooManyRequests"
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
      throw new FabricApiError(
        (errorBody?.message as string) ?? response.statusText,
        response.status,
        (errorBody?.errorCode as string) ?? undefined,
        (errorBody?.relatedResource as string) ?? undefined
      );
    }

    return { data: body as T, lro, status: response.status };
  }

  async get<T = unknown>(path: string): Promise<FabricResponse<T>> {
    const headers = await this.getHeaders();
    const response = await fetch(`${FABRIC_BASE_URL}${path}`, { headers });
    return this.handleResponse<T>(response);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<FabricResponse<T>> {
    const headers = await this.getHeaders();
    const response = await fetch(`${FABRIC_BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(response);
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<FabricResponse<T>> {
    const headers = await this.getHeaders();
    const response = await fetch(`${FABRIC_BASE_URL}${path}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(response);
  }

  async delete<T = unknown>(path: string): Promise<FabricResponse<T>> {
    const headers = await this.getHeaders();
    const response = await fetch(`${FABRIC_BASE_URL}${path}`, {
      method: "DELETE",
      headers,
    });
    return this.handleResponse<T>(response);
  }

  async getFullUrl<T = unknown>(url: string): Promise<FabricResponse<T>> {
    const headers = await this.getHeaders();
    const response = await fetch(url, { headers });
    return this.handleResponse<T>(response);
  }
}
