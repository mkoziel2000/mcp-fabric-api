import { TokenManager } from "../auth/token-manager.js";
import { FabricApiError } from "../core/errors.js";

const POWERBI_BASE_URL = "https://api.powerbi.com/v1.0/myorg";

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

  private async handleResponse<T>(response: Response): Promise<PowerBIResponse<T>> {
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 30000;
      throw new FabricApiError(
        `Rate limited. Retry after ${waitMs / 1000}s`,
        429,
        "TooManyRequests"
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
      throw new FabricApiError(
        (errorBody?.message as string) ?? response.statusText,
        response.status,
        (errorBody?.errorCode as string) ?? undefined
      );
    }

    return { data: body as T, status: response.status };
  }

  async get<T = unknown>(path: string): Promise<PowerBIResponse<T>> {
    const headers = await this.getHeaders();
    const response = await fetch(`${POWERBI_BASE_URL}${path}`, { headers });
    return this.handleResponse<T>(response);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<PowerBIResponse<T>> {
    const headers = await this.getHeaders();
    const response = await fetch(`${POWERBI_BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(response);
  }

  async delete<T = unknown>(path: string): Promise<PowerBIResponse<T>> {
    const headers = await this.getHeaders();
    const response = await fetch(`${POWERBI_BASE_URL}${path}`, {
      method: "DELETE",
      headers,
    });
    return this.handleResponse<T>(response);
  }
}
