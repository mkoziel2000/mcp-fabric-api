import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation } from "../core/lro.js";

export function registerLakehouseTools(server: McpServer, fabricClient: FabricClient) {
  server.tool(
    "lakehouse_list",
    "List all lakehouses in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const lakehouses = await paginateAll(fabricClient, `/workspaces/${workspaceId}/lakehouses`);
        return { content: [{ type: "text", text: JSON.stringify(lakehouses, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_get",
    "Get details of a specific lakehouse including SQL endpoint and OneLake paths",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
    },
    async ({ workspaceId, lakehouseId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/lakehouses/${lakehouseId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_create",
    "Create a new lakehouse in a workspace (long-running operation)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the lakehouse"),
      description: z.string().optional().describe("Description of the lakehouse"),
    },
    async ({ workspaceId, displayName, description }) => {
      try {
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/lakehouses`, body);
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify({ operation: state, item: response.data }, null, 2) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_update",
    "Update a lakehouse's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, lakehouseId, displayName, description }) => {
      try {
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/lakehouses/${lakehouseId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_delete",
    "Delete a lakehouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
    },
    async ({ workspaceId, lakehouseId }) => {
      try {
        await fabricClient.delete(`/workspaces/${workspaceId}/lakehouses/${lakehouseId}`);
        return { content: [{ type: "text", text: `Lakehouse ${lakehouseId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_list_tables",
    "List all tables in a lakehouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
    },
    async ({ workspaceId, lakehouseId }) => {
      try {
        const tables = await paginateAll(fabricClient, `/workspaces/${workspaceId}/lakehouses/${lakehouseId}/tables`, "data");
        return { content: [{ type: "text", text: JSON.stringify(tables, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_load_table",
    "Load data into a lakehouse table from a file path (long-running operation)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      tableName: z.string().describe("Target table name"),
      relativePath: z.string().describe("Relative path to the source file in OneLake"),
      pathType: z.enum(["File", "Folder"]).describe("Type of the source path"),
      mode: z.enum(["Overwrite", "Append"]).optional().describe("Load mode (default: Overwrite)"),
      formatOptions: z.object({
        format: z.enum(["Csv", "Parquet", "Json"]).describe("File format"),
        header: z.boolean().optional().describe("Whether CSV has a header row"),
        delimiter: z.string().optional().describe("CSV delimiter character"),
      }).optional().describe("Format options for the source file"),
    },
    async ({ workspaceId, lakehouseId, tableName, relativePath, pathType, mode, formatOptions }) => {
      try {
        const body: Record<string, unknown> = { relativePath, pathType };
        if (mode) body.mode = mode;
        if (formatOptions) body.formatOptions = formatOptions;
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/lakehouses/${lakehouseId}/tables/${tableName}/load`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "Table load initiated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_get_sql_endpoint",
    "Get the SQL endpoint details for a lakehouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
    },
    async ({ workspaceId, lakehouseId }) => {
      try {
        const response = await fabricClient.get<Record<string, unknown>>(`/workspaces/${workspaceId}/lakehouses/${lakehouseId}`);
        const properties = response.data.properties as Record<string, unknown> | undefined;
        const sqlEndpoint = properties?.sqlEndpointProperties;
        if (!sqlEndpoint) {
          return { content: [{ type: "text", text: "No SQL endpoint available for this lakehouse" }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(sqlEndpoint, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
