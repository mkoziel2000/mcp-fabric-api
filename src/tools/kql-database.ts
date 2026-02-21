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

export function registerKqlDatabaseTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "kql_database_list",
    "List all KQL databases in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const items = await paginateAll(fabricClient, `/workspaces/${workspaceId}/kqlDatabases`);
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "kql_database_get",
    "Get details of a specific KQL database",
    {
      workspaceId: z.string().describe("The workspace ID"),
      kqlDatabaseId: z.string().describe("The KQL database ID"),
    },
    async ({ workspaceId, kqlDatabaseId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/kqlDatabases/${kqlDatabaseId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "kql_database_create",
    "Create a new KQL database in a workspace (long-running). Requires a parent eventhouse.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the KQL database"),
      description: z.string().optional().describe("Description of the KQL database"),
      databaseType: z.enum(["ReadWrite", "ReadOnlyShortcut"]).describe("Database type"),
      parentEventhouseItemId: z.string().describe("Parent eventhouse item ID"),
    },
    async ({ workspaceId, displayName, description, databaseType, parentEventhouseItemId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {
          displayName,
          creationPayload: { databaseType, parentEventhouseItemId },
        };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/kqlDatabases`, body);
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
    "kql_database_update",
    "Update a KQL database's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      kqlDatabaseId: z.string().describe("The KQL database ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, kqlDatabaseId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/kqlDatabases/${kqlDatabaseId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "kql_database_delete",
    "Delete a KQL database",
    {
      workspaceId: z.string().describe("The workspace ID"),
      kqlDatabaseId: z.string().describe("The KQL database ID"),
    },
    async ({ workspaceId, kqlDatabaseId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/kqlDatabases/${kqlDatabaseId}`);
        return { content: [{ type: "text", text: `KQL database ${kqlDatabaseId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "kql_database_get_definition",
    "Get the definition of a KQL database (long-running). Writes definition files to the specified output directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      kqlDatabaseId: z.string().describe("The KQL database ID"),
      outputDirectoryPath: z.string().describe("Directory path where definition files will be written"),
    },
    async ({ workspaceId, kqlDatabaseId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/kqlDatabases/${kqlDatabaseId}/getDefinition`
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
        return { content: [{ type: "text", text: `KQL database definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "kql_database_update_definition",
    "Update a KQL database's definition (long-running). Accepts definition parts inline or a directory path.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      kqlDatabaseId: z.string().describe("The KQL database ID"),
      parts: z.array(z.object({
        path: z.string().describe("The definition part path"),
        content: z.string().describe("The file content as a string"),
      })).optional().describe("Array of definition parts to upload"),
      partsDirectoryPath: z.string().optional().describe("Path to a directory containing definition files"),
    },
    async ({ workspaceId, kqlDatabaseId, parts, partsDirectoryPath }) => {
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
          `/workspaces/${workspaceId}/kqlDatabases/${kqlDatabaseId}/updateDefinition`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "KQL database definition updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
