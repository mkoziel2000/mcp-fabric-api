import { DefaultAzureCredential, type AccessToken } from "@azure/identity";

const FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default";
const POWERBI_SCOPE = "https://analysis.windows.net/powerbi/api/.default";
const DATABASE_SCOPE = "https://database.windows.net/.default";
const KUSTO_SCOPE = "https://api.kusto.windows.net/.default";
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

export class TokenManager {
  private credential: DefaultAzureCredential;
  private cache = new Map<string, AccessToken>();
  private currentTenantId: string | undefined;

  constructor(tenantId?: string) {
    this.currentTenantId = tenantId;
    this.credential = tenantId
      ? new DefaultAzureCredential({ tenantId })
      : new DefaultAzureCredential();
  }

  switchTenant(tenantId?: string): void {
    this.currentTenantId = tenantId;
    this.credential = tenantId
      ? new DefaultAzureCredential({ tenantId })
      : new DefaultAzureCredential();
    this.cache.clear();
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCurrentTenantId(): string | undefined {
    return this.currentTenantId;
  }

  getCachedToken(scope: "fabric" | "powerbi" | "database" | "kusto"): AccessToken | undefined {
    const scopeUrl = scope === "fabric" ? FABRIC_SCOPE : scope === "powerbi" ? POWERBI_SCOPE : scope === "kusto" ? KUSTO_SCOPE : DATABASE_SCOPE;
    return this.cache.get(scopeUrl);
  }

  async getToken(scope: "fabric" | "powerbi" | "database" | "kusto"): Promise<string> {
    const scopeUrl = scope === "fabric" ? FABRIC_SCOPE : scope === "powerbi" ? POWERBI_SCOPE : scope === "kusto" ? KUSTO_SCOPE : DATABASE_SCOPE;
    const cached = this.cache.get(scopeUrl);
    if (cached && cached.expiresOnTimestamp - Date.now() > REFRESH_BUFFER_MS) {
      return cached.token;
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
      if (message.includes("az login") || message.includes("DefaultAzureCredential")) {
        throw new Error(
          `Azure authentication failed. Run 'az login' first to authenticate.\nDetails: ${message}`
        );
      }
      throw error;
    }
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
}
