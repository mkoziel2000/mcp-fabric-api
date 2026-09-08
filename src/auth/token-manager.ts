import {
  DefaultAzureCredential,
  DeviceCodeCredential,
  ClientSecretCredential,
  InteractiveBrowserCredential,
  type DeviceCodeInfo,
  type TokenCredential,
  type AccessToken,
} from "@azure/identity";
import { DeviceCodeAuthRequired } from "../core/errors.js";

const FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default";
const POWERBI_SCOPE = "https://analysis.windows.net/powerbi/api/.default";
const DATABASE_SCOPE = "https://database.windows.net/.default";
const KUSTO_SCOPE = "https://api.kusto.windows.net/.default";
const ONELAKE_SCOPE = "https://storage.azure.com/.default";
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

export type AuthMethod = "default" | "device-code" | "client-secret" | "interactive-browser";

export interface AuthConfig {
  method: AuthMethod;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  /** Called with the device code prompt message so callers can surface it to the user (e.g., via MCP notifications). */
  onDeviceCodePrompt?: (message: string) => void;
}

export class TokenManager {
  private credential: TokenCredential;
  private cache = new Map<string, AccessToken>();
  private currentTenantId: string | undefined;
  private authConfig: AuthConfig;
  /** Background device-code auth promises keyed by scope URL */
  private pendingDeviceCodeAuth = new Map<string, Promise<AccessToken>>();
  /** Latest device code message for display to user */
  private lastDeviceCodeMessage: string | null = null;

  constructor(config?: AuthConfig) {
    this.authConfig = config ?? { method: "default" };
    this.currentTenantId = this.authConfig.tenantId;
    this.credential = this.createCredential(this.currentTenantId);
  }

  private createCredential(tenantId?: string): TokenCredential {
    const { method, clientId, clientSecret } = this.authConfig;

    switch (method) {
      case "device-code": {
        if (!clientId || !tenantId) {
          throw new Error(
            "AUTH_METHOD=device-code requires AZURE_CLIENT_ID and AZURE_TENANT_ID"
          );
        }
        const { onDeviceCodePrompt } = this.authConfig;
        return new DeviceCodeCredential({
          tenantId,
          clientId,
          userPromptCallback: (info: DeviceCodeInfo) => {
            console.error(`\n[Auth] ${info.message}\n`);
            this.lastDeviceCodeMessage = info.message;
            if (onDeviceCodePrompt) {
              onDeviceCodePrompt(info.message);
            }
          },
        });
      }

      case "client-secret": {
        if (!tenantId || !clientId || !clientSecret) {
          throw new Error(
            "AUTH_METHOD=client-secret requires AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET"
          );
        }
        return new ClientSecretCredential(tenantId, clientId, clientSecret);
      }

      case "interactive-browser": {
        return new InteractiveBrowserCredential({
          tenantId,
          clientId,
        });
      }

      default: {
        return tenantId
          ? new DefaultAzureCredential({ tenantId })
          : new DefaultAzureCredential();
      }
    }
  }

  switchTenant(tenantId?: string): void {
    this.currentTenantId = tenantId;
    this.credential = this.createCredential(tenantId);
    this.cache.clear();
    this.pendingDeviceCodeAuth.clear();
    this.lastDeviceCodeMessage = null;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCurrentTenantId(): string | undefined {
    return this.currentTenantId;
  }

  private resolveScopeUrl(scope: "fabric" | "powerbi" | "database" | "kusto" | "onelake"): string {
    switch (scope) {
      case "fabric": return FABRIC_SCOPE;
      case "powerbi": return POWERBI_SCOPE;
      case "kusto": return KUSTO_SCOPE;
      case "onelake": return ONELAKE_SCOPE;
      default: return DATABASE_SCOPE;
    }
  }

  getCachedToken(scope: "fabric" | "powerbi" | "database" | "kusto" | "onelake"): AccessToken | undefined {
    return this.cache.get(this.resolveScopeUrl(scope));
  }

  async getToken(scope: "fabric" | "powerbi" | "database" | "kusto" | "onelake"): Promise<string> {
    const scopeUrl = this.resolveScopeUrl(scope);
    const cached = this.cache.get(scopeUrl);
    if (cached && cached.expiresOnTimestamp - Date.now() > REFRESH_BUFFER_MS) {
      return cached.token;
    }

    // For device-code flow, start auth in the background and return the code to the user immediately
    if (this.authConfig.method === "device-code") {
      return this.getTokenWithDeviceCode(scopeUrl);
    }

    try {
      const token = await this.credential.getToken(scopeUrl);
      if (!token) {
        throw new Error(`Failed to acquire token for scope: ${scopeUrl}`);
      }
      this.cache.set(scopeUrl, token);
      return token.token;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const method = this.authConfig.method;

      if (method === "client-secret") {
        throw new Error(
          `Client secret authentication failed. Verify AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET are correct.\nDetails: ${message}`
        );
      }
      if (method === "interactive-browser") {
        throw new Error(
          `Interactive browser authentication failed. Ensure a browser is accessible.\nDetails: ${message}`
        );
      }
      if (message.includes("az login") || message.includes("DefaultAzureCredential")) {
        throw new Error(
          `Azure authentication failed. Run 'az login' first to authenticate.\nDetails: ${message}`
        );
      }
      throw error;
    }
  }

  /**
   * Device-code specific token acquisition.
   * Starts polling in the background and throws DeviceCodeAuthRequired immediately
   * so the tool can return the auth URL/code to the user instead of blocking.
   */
  private async getTokenWithDeviceCode(scopeUrl: string): Promise<string> {
    // If there's already a pending auth for this scope, check if it completed
    const pending = this.pendingDeviceCodeAuth.get(scopeUrl);
    if (pending) {
      // Race: either the background auth completed, or we time out quickly
      const POLL_TIMEOUT_MS = 3000;
      const result = await Promise.race([
        pending.then((token) => ({ resolved: true as const, token })),
        new Promise<{ resolved: false }>((resolve) =>
          setTimeout(() => resolve({ resolved: false }), POLL_TIMEOUT_MS)
        ),
      ]);

      if (result.resolved) {
        this.cache.set(scopeUrl, result.token);
        this.pendingDeviceCodeAuth.delete(scopeUrl);
        this.lastDeviceCodeMessage = null;
        return result.token.token;
      }

      // Still waiting — remind the user
      throw new DeviceCodeAuthRequired(
        this.lastDeviceCodeMessage ?? "Device code authentication is in progress. Please complete sign-in in your browser."
      );
    }

    // No pending auth — start a new one in the background
    this.lastDeviceCodeMessage = null;
    const authPromise = this.credential.getToken(scopeUrl).then((token) => {
      if (!token) throw new Error(`Failed to acquire token for scope: ${scopeUrl}`);
      return token;
    });

    this.pendingDeviceCodeAuth.set(scopeUrl, authPromise);

    // Handle background completion/failure
    authPromise
      .then((token) => {
        this.cache.set(scopeUrl, token);
        this.pendingDeviceCodeAuth.delete(scopeUrl);
        this.lastDeviceCodeMessage = null;
        console.error(`[Auth] Device code authentication completed for scope: ${scopeUrl}`);
      })
      .catch((err) => {
        this.pendingDeviceCodeAuth.delete(scopeUrl);
        console.error(`[Auth] Device code authentication failed: ${err instanceof Error ? err.message : String(err)}`);
      });

    // Wait briefly for the device code callback to fire so we can capture the message
    const CALLBACK_WAIT_MS = 3000;
    await new Promise((resolve) => setTimeout(resolve, CALLBACK_WAIT_MS));

    // If the auth already completed (e.g., cached token in the credential), return it
    const nowCached = this.cache.get(scopeUrl);
    if (nowCached && nowCached.expiresOnTimestamp - Date.now() > REFRESH_BUFFER_MS) {
      return nowCached.token;
    }

    // Throw the device code info back to the caller so it surfaces in the tool response
    throw new DeviceCodeAuthRequired(
      this.lastDeviceCodeMessage ?? "Device code authentication started. Please check the MCP server logs for the sign-in URL and code."
    );
  }

  async getFabricToken(): Promise<string> {
    return this.getToken("fabric");
  }

  async getPowerBIToken(): Promise<string> {
    return this.getToken("powerbi");
  }

  async getDatabaseToken(): Promise<string> {
    return this.getToken("database");
  }

  async getKustoToken(): Promise<string> {
    return this.getToken("kusto");
  }

  async getOneLakeToken(): Promise<string> {
    return this.getToken("onelake");
  }
}
