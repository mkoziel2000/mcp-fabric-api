import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";

export function registerSqlEndpointTools(server: McpServer, fabricClient: FabricClient) {
  server.tool(
    "sql_endpoint_list",
    "List all SQL endpoints in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const endpoints = await paginateAll(fabricClient, `/workspaces/${workspaceId}/sqlEndpoints`);
        return { content: [{ type: "text", text: JSON.stringify(endpoints, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "sql_endpoint_get",
    "Get details of a specific SQL endpoint, including connection string",
    {
      workspaceId: z.string().describe("The workspace ID"),
      sqlEndpointId: z.string().describe("The SQL endpoint ID"),
    },
    async ({ workspaceId, sqlEndpointId }) => {
      try {
        const response = await fabricClient.get<Record<string, unknown>>(
          `/workspaces/${workspaceId}/sqlEndpoints/${sqlEndpointId}`
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "sql_endpoint_get_connection_string",
    "Get the TDS connection string for a SQL endpoint",
    {
      workspaceId: z.string().describe("The workspace ID"),
      sqlEndpointId: z.string().describe("The SQL endpoint ID"),
    },
    async ({ workspaceId, sqlEndpointId }) => {
      try {
        const response = await fabricClient.get<Record<string, unknown>>(
          `/workspaces/${workspaceId}/sqlEndpoints/${sqlEndpointId}`
        );
        const properties = response.data.properties as Record<string, unknown> | undefined;
        const connectionString = properties?.connectionString as string | undefined;
        if (!connectionString) {
          return { content: [{ type: "text", text: "No connection string available for this SQL endpoint. The endpoint may still be provisioning." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ connectionString }, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
