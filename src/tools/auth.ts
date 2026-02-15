import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TokenManager } from "../auth/token-manager.js";
import { formatToolError } from "../core/errors.js";

const execFileAsync = promisify(execFile);

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT: expected 3 parts");
  }
  const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
  return JSON.parse(payload);
}

export function registerAuthTools(server: McpServer, tokenManager: TokenManager) {
  server.tool(
    "auth_get_current_account",
    "Show the current Azure identity, tenant, and token expiry by decoding the Fabric JWT",
    {},
    async () => {
      try {
        const token = await tokenManager.getFabricToken();
        const claims = decodeJwtPayload(token);

        const info: Record<string, unknown> = {
          tenantId: claims.tid ?? tokenManager.getCurrentTenantId() ?? "unknown",
          objectId: claims.oid ?? "unknown",
          appId: claims.appid ?? claims.azp ?? "unknown",
          upn: claims.upn ?? claims.unique_name ?? "unknown",
          name: claims.name ?? "unknown",
          expiresAt: claims.exp
            ? new Date((claims.exp as number) * 1000).toISOString()
            : "unknown",
          issuedAt: claims.iat
            ? new Date((claims.iat as number) * 1000).toISOString()
            : "unknown",
          scopes: claims.scp ?? claims.roles ?? "unknown",
        };

        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "auth_list_available_accounts",
    "List Azure subscriptions and tenants the local user has logged into via 'az login'. Reads local CLI state only — does not query Entra ID or list other users.",
    {},
    async () => {
      try {
        const { stdout } = await execFileAsync("az", ["account", "list", "--output", "json"], {
          timeout: 15_000,
        });

        const accounts = JSON.parse(stdout) as Array<Record<string, unknown>>;

        // Group by tenant
        const byTenant = new Map<string, Array<Record<string, unknown>>>();
        for (const acct of accounts) {
          const tid = String(acct.tenantId ?? "unknown");
          if (!byTenant.has(tid)) byTenant.set(tid, []);
          byTenant.get(tid)!.push({
            name: acct.name,
            id: acct.id,
            isDefault: acct.isDefault,
            state: acct.state,
            user: acct.user,
          });
        }

        const result = Object.fromEntries(byTenant);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("ENOENT") || message.includes("not found") || message.includes("not recognized")) {
          return formatToolError(
            new Error("Azure CLI ('az') is not installed or not on PATH. Install it from https://aka.ms/installazurecli")
          );
        }
        if (message.includes("az login") || message.includes("Please run")) {
          return formatToolError(
            new Error("Not logged in to Azure CLI. Run 'az login' first.")
          );
        }
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "auth_switch_tenant",
    "Switch to a different Azure tenant. Acquires a new token to verify access; rolls back on failure.",
    {
      tenantId: z.string().describe("The Azure AD tenant ID (GUID) to switch to"),
    },
    async ({ tenantId }) => {
      const previousTenantId = tokenManager.getCurrentTenantId();

      try {
        tokenManager.switchTenant(tenantId);

        // Verify the new tenant works by acquiring a token
        const token = await tokenManager.getFabricToken();
        const claims = decodeJwtPayload(token);

        const info = {
          switched: true,
          previousTenantId: previousTenantId ?? "default",
          newTenantId: tenantId,
          identity: claims.upn ?? claims.unique_name ?? claims.oid ?? "unknown",
          expiresAt: claims.exp
            ? new Date((claims.exp as number) * 1000).toISOString()
            : "unknown",
        };

        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      } catch (error) {
        // Rollback to previous tenant
        tokenManager.switchTenant(previousTenantId);

        const message = error instanceof Error ? error.message : String(error);
        return formatToolError(
          new Error(
            `Failed to switch to tenant ${tenantId}. Rolled back to ${previousTenantId ?? "default"}.\nDetails: ${message}`
          )
        );
      }
    }
  );

  server.tool(
    "auth_clear_token_cache",
    "Clear cached authentication tokens to force re-acquisition on next API call",
    {},
    async () => {
      try {
        tokenManager.clearCache();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              cleared: true,
              currentTenantId: tokenManager.getCurrentTenantId() ?? "default",
              message: "Token cache cleared. Next API call will acquire fresh tokens.",
            }, null, 2),
          }],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
