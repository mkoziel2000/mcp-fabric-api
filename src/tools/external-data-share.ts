import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";

export function registerExternalDataShareTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "external_data_share_list",
    "List all external data shares for an item",
    {
      workspaceId: z.string().describe("The workspace ID"),
      itemId: z.string().describe("The item ID"),
    },
    async ({ workspaceId, itemId }) => {
      try {
        const shares = await paginateAll(fabricClient, `/workspaces/${workspaceId}/items/${itemId}/externalDataShares`);
        return { content: [{ type: "text", text: JSON.stringify(shares, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "external_data_share_get",
    "Get details of a specific external data share",
    {
      workspaceId: z.string().describe("The workspace ID"),
      itemId: z.string().describe("The item ID"),
      externalDataShareId: z.string().describe("The external data share ID"),
    },
    async ({ workspaceId, itemId, externalDataShareId }) => {
      try {
        const response = await fabricClient.get(
          `/workspaces/${workspaceId}/items/${itemId}/externalDataShares/${externalDataShareId}`
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "external_data_share_create",
    "Create a new external data share for an item",
    {
      workspaceId: z.string().describe("The workspace ID"),
      itemId: z.string().describe("The item ID"),
      paths: z.array(z.string()).describe("Array of paths to share externally"),
      recipientUserPrincipalName: z.string().describe("User principal name of the recipient (email)"),
    },
    async ({ workspaceId, itemId, paths, recipientUserPrincipalName }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body = { paths, recipient: { userPrincipalName: recipientUserPrincipalName } };
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/items/${itemId}/externalDataShares`,
          body
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "external_data_share_revoke",
    "Revoke an external data share",
    {
      workspaceId: z.string().describe("The workspace ID"),
      itemId: z.string().describe("The item ID"),
      externalDataShareId: z.string().describe("The external data share ID to revoke"),
    },
    async ({ workspaceId, itemId, externalDataShareId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.post(
          `/workspaces/${workspaceId}/items/${itemId}/externalDataShares/${externalDataShareId}/revoke`
        );
        return { content: [{ type: "text", text: `External data share ${externalDataShareId} revoked successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
