import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { KustoClient } from "../client/kusto-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";

export function registerEventhouseTools(server: McpServer, fabricClient: FabricClient, kustoClient: KustoClient) {
  server.tool(
    "eventhouse_list",
    "List all eventhouses in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const eventhouses = await paginateAll(fabricClient, `/workspaces/${workspaceId}/eventhouses`);
        return { content: [{ type: "text", text: JSON.stringify(eventhouses, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "eventhouse_get",
    "Get details of a specific eventhouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      eventhouseId: z.string().describe("The eventhouse ID"),
    },
    async ({ workspaceId, eventhouseId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/eventhouses/${eventhouseId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "eventhouse_create",
    "Create a new eventhouse in a workspace (long-running operation)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the eventhouse"),
      description: z.string().optional().describe("Description of the eventhouse"),
    },
    async ({ workspaceId, displayName, description }) => {
      try {
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/eventhouses`, body);
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          const result = await getOperationResult(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify({ operation: state, item: result ?? response.data }, null, 2) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "eventhouse_update",
    "Update an eventhouse's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      eventhouseId: z.string().describe("The eventhouse ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, eventhouseId, displayName, description }) => {
      try {
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/eventhouses/${eventhouseId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "eventhouse_delete",
    "Delete an eventhouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      eventhouseId: z.string().describe("The eventhouse ID"),
    },
    async ({ workspaceId, eventhouseId }) => {
      try {
        await fabricClient.delete(`/workspaces/${workspaceId}/eventhouses/${eventhouseId}`);
        return { content: [{ type: "text", text: `Eventhouse ${eventhouseId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "eventhouse_get_sql_endpoint",
    "Get the query service URI and connection details for an eventhouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      eventhouseId: z.string().describe("The eventhouse ID"),
    },
    async ({ workspaceId, eventhouseId }) => {
      try {
        const response = await fabricClient.get<Record<string, unknown>>(`/workspaces/${workspaceId}/eventhouses/${eventhouseId}`);
        const properties = response.data.properties as Record<string, unknown> | undefined;
        if (!properties) {
          return { content: [{ type: "text", text: "No connection details available for this eventhouse. It may still be provisioning." }] };
        }
        const result: Record<string, unknown> = {};
        if (properties.queryServiceUri) result.queryServiceUri = properties.queryServiceUri;
        if (properties.ingestionServiceUri) result.ingestionServiceUri = properties.ingestionServiceUri;
        if (properties.databaseName) result.databaseName = properties.databaseName;
        if (Object.keys(result).length === 0) {
          return { content: [{ type: "text", text: "No connection details available for this eventhouse. It may still be provisioning." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "eventhouse_execute_kql",
    "Execute a KQL query against an eventhouse's KQL database",
    {
      workspaceId: z.string().describe("The workspace ID"),
      eventhouseId: z.string().describe("The eventhouse ID"),
      database: z.string().describe("KQL database name to query"),
      query: z.string().describe("KQL query string to execute"),
      maxRows: z.number().optional().describe("Maximum number of rows to return (default 1000)"),
    },
    async ({ workspaceId, eventhouseId, database, query, maxRows }) => {
      try {
        const response = await fabricClient.get<Record<string, unknown>>(`/workspaces/${workspaceId}/eventhouses/${eventhouseId}`);
        const properties = response.data.properties as Record<string, unknown> | undefined;
        const queryServiceUri = properties?.queryServiceUri as string | undefined;
        if (!queryServiceUri) {
          return {
            content: [{ type: "text", text: "The eventhouse does not have a query service URI. It may still be provisioning. Use eventhouse_get_sql_endpoint to check status." }],
            isError: true,
          };
        }
        const result = await kustoClient.executeQuery(queryServiceUri, database, query, maxRows);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
