import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { SqlClient } from "../client/sql-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";

export function registerSqlEndpointTools(server: McpServer, fabricClient: FabricClient, sqlClient: SqlClient) {
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

  server.tool(
    "sql_endpoint_execute_query",
    "Execute a T-SQL query against a lakehouse or warehouse SQL endpoint",
    {
      query: z.string().describe("T-SQL query to execute"),
      workspaceId: z.string().describe("The workspace ID containing the resource"),
      itemId: z.string().describe("The lakehouse or warehouse ID"),
      itemType: z.enum(["Lakehouse", "Warehouse"]).describe("Type of the item to query"),
      database: z.string().optional().describe("Database name (defaults to the item's display name)"),
      maxRows: z.number().optional().describe("Maximum rows to return (default: 1000)"),
    },
    async ({ query, workspaceId, itemId, itemType, database, maxRows }) => {
      try {
        let connectionString: string | undefined;
        let displayName: string | undefined;

        if (itemType === "Lakehouse") {
          const response = await fabricClient.get<Record<string, unknown>>(
            `/workspaces/${workspaceId}/lakehouses/${itemId}`
          );
          displayName = response.data.displayName as string | undefined;
          const properties = response.data.properties as Record<string, unknown> | undefined;
          const sqlEndpointProps = properties?.sqlEndpointProperties as Record<string, unknown> | undefined;
          connectionString = sqlEndpointProps?.connectionString as string | undefined;
        } else {
          const response = await fabricClient.get<Record<string, unknown>>(
            `/workspaces/${workspaceId}/warehouses/${itemId}`
          );
          displayName = response.data.displayName as string | undefined;
          const properties = response.data.properties as Record<string, unknown> | undefined;
          connectionString = properties?.connectionString as string | undefined;
        }

        if (!connectionString) {
          return { content: [{ type: "text", text: `No SQL endpoint connection string available for this ${itemType.toLowerCase()}. It may still be provisioning.` }] };
        }

        const server = connectionString.replace(/^.*?:\/\//, "").replace(/,.*$/, "").replace(/;.*$/, "");
        const dbName = database ?? displayName ?? itemId;

        const result = await sqlClient.executeQuery(server, dbName, query, maxRows);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
