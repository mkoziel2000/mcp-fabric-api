import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { encodeBase64, decodeBase64 } from "../utils/base64.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import { resolveFilesOrDirectory, writeFilesToDirectory } from "../utils/file-utils.js";
import type { FileEntry } from "../utils/file-utils.js";

export function registerWarehouseTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "warehouse_list",
    "List all warehouses in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const warehouses = await paginateAll(fabricClient, `/workspaces/${workspaceId}/warehouses`);
        return { content: [{ type: "text", text: JSON.stringify(warehouses, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "warehouse_get",
    "Get details of a specific warehouse including connection string and provisioning status",
    {
      workspaceId: z.string().describe("The workspace ID"),
      warehouseId: z.string().describe("The warehouse ID"),
    },
    async ({ workspaceId, warehouseId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/warehouses/${warehouseId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "warehouse_create",
    "Create a new warehouse in a workspace (long-running operation)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the warehouse"),
      description: z.string().optional().describe("Description of the warehouse"),
    },
    async ({ workspaceId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/warehouses`, body);
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
    "warehouse_update",
    "Update a warehouse's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      warehouseId: z.string().describe("The warehouse ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, warehouseId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/warehouses/${warehouseId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "warehouse_delete",
    "Delete a warehouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      warehouseId: z.string().describe("The warehouse ID"),
    },
    async ({ workspaceId, warehouseId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/warehouses/${warehouseId}`);
        return { content: [{ type: "text", text: `Warehouse ${warehouseId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "warehouse_get_sql_endpoint",
    "Get the SQL connection details for a warehouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      warehouseId: z.string().describe("The warehouse ID"),
    },
    async ({ workspaceId, warehouseId }) => {
      try {
        const response = await fabricClient.get<Record<string, unknown>>(`/workspaces/${workspaceId}/warehouses/${warehouseId}`);
        const properties = response.data.properties as Record<string, unknown> | undefined;
        const connectionString = properties?.connectionString as string | undefined;
        const provisioningStatus = properties?.provisioningStatus as string | undefined;
        if (!connectionString) {
          return { content: [{ type: "text", text: "No connection string available for this warehouse. The warehouse may still be provisioning." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ connectionString, provisioningStatus }, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "warehouse_list_tables",
    "List all tables in a warehouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      warehouseId: z.string().describe("The warehouse ID"),
    },
    async ({ workspaceId, warehouseId }) => {
      try {
        const tables = await paginateAll(fabricClient, `/workspaces/${workspaceId}/warehouses/${warehouseId}/tables`, "data");
        return { content: [{ type: "text", text: JSON.stringify(tables, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "warehouse_get_definition",
    "Get the definition of a warehouse (long-running). Writes definition files to the specified output directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      warehouseId: z.string().describe("The warehouse ID"),
      outputDirectoryPath: z.string().describe("Directory path where definition files will be written"),
    },
    async ({ workspaceId, warehouseId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/warehouses/${warehouseId}/getDefinition`
        );
        type DefPart = { path: string; payload: string; payloadType: string };
        let parts: DefPart[] | undefined;
        if (response.lro) {
          await pollOperation(fabricClient, response.lro.operationId);
          const result = await getOperationResult<Record<string, unknown>>(fabricClient, response.lro.operationId);
          if (result?.definition) {
            parts = (result.definition as { parts: DefPart[] }).parts;
          }
        }
        if (!parts && response.data?.definition) {
          parts = (response.data.definition as { parts: DefPart[] }).parts;
        }
        if (!parts) {
          return { content: [{ type: "text", text: "No definition returned from Fabric API" }], isError: true };
        }
        const files = parts.map((part) => ({
          path: part.path,
          content: part.payloadType === "InlineBase64" ? decodeBase64(part.payload) : part.payload,
        }));
        const written = await writeFilesToDirectory(outputDirectoryPath, files);
        return { content: [{ type: "text", text: `Warehouse definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "warehouse_update_definition",
    "Update a warehouse's definition (long-running). Accepts definition parts inline or a directory path.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      warehouseId: z.string().describe("The warehouse ID"),
      parts: z.array(z.object({
        path: z.string().describe("The definition part path"),
        content: z.string().describe("The file content as a string"),
      })).optional().describe("Array of definition parts to upload"),
      partsDirectoryPath: z.string().optional().describe("Path to a directory containing definition files"),
    },
    async ({ workspaceId, warehouseId, parts, partsDirectoryPath }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const resolved: FileEntry[] = await resolveFilesOrDirectory(parts, partsDirectoryPath);
        const body = {
          definition: {
            parts: resolved.map((part) => ({
              path: part.path,
              payload: encodeBase64(part.content),
              payloadType: "InlineBase64",
            })),
          },
        };
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/warehouses/${warehouseId}/updateDefinition`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "Warehouse definition updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
