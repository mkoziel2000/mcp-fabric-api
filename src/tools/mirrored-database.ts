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

export function registerMirroredDatabaseTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "mirrored_database_list",
    "List all mirrored databases in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const items = await paginateAll(fabricClient, `/workspaces/${workspaceId}/mirroredDatabases`);
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "mirrored_database_get",
    "Get details of a specific mirrored database",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mirroredDatabaseId: z.string().describe("The mirrored database ID"),
    },
    async ({ workspaceId, mirroredDatabaseId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/mirroredDatabases/${mirroredDatabaseId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "mirrored_database_create",
    "Create a new mirrored database in a workspace (long-running)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the mirrored database"),
      description: z.string().optional().describe("Description of the mirrored database"),
    },
    async ({ workspaceId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/mirroredDatabases`, body);
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
    "mirrored_database_update",
    "Update a mirrored database's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mirroredDatabaseId: z.string().describe("The mirrored database ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, mirroredDatabaseId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/mirroredDatabases/${mirroredDatabaseId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "mirrored_database_delete",
    "Delete a mirrored database",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mirroredDatabaseId: z.string().describe("The mirrored database ID"),
    },
    async ({ workspaceId, mirroredDatabaseId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/mirroredDatabases/${mirroredDatabaseId}`);
        return { content: [{ type: "text", text: `Mirrored database ${mirroredDatabaseId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "mirrored_database_get_definition",
    "Get the definition of a mirrored database (long-running). Writes definition files to the specified output directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mirroredDatabaseId: z.string().describe("The mirrored database ID"),
      outputDirectoryPath: z.string().describe("Directory path where definition files will be written"),
    },
    async ({ workspaceId, mirroredDatabaseId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/mirroredDatabases/${mirroredDatabaseId}/getDefinition`
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
        return { content: [{ type: "text", text: `Mirrored database definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "mirrored_database_update_definition",
    "Update a mirrored database's definition (long-running). Accepts definition parts inline or a directory path.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mirroredDatabaseId: z.string().describe("The mirrored database ID"),
      parts: z.array(z.object({
        path: z.string().describe("The definition part path"),
        content: z.string().describe("The file content as a string"),
      })).optional().describe("Array of definition parts to upload"),
      partsDirectoryPath: z.string().optional().describe("Path to a directory containing definition files"),
    },
    async ({ workspaceId, mirroredDatabaseId, parts, partsDirectoryPath }) => {
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
          `/workspaces/${workspaceId}/mirroredDatabases/${mirroredDatabaseId}/updateDefinition`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "Mirrored database definition updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "mirrored_database_start_mirroring",
    "Start mirroring for a mirrored database",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mirroredDatabaseId: z.string().describe("The mirrored database ID"),
    },
    async ({ workspaceId, mirroredDatabaseId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.post(`/workspaces/${workspaceId}/mirroredDatabases/${mirroredDatabaseId}/startMirroring`);
        return { content: [{ type: "text", text: "Mirroring started successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "mirrored_database_stop_mirroring",
    "Stop mirroring for a mirrored database",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mirroredDatabaseId: z.string().describe("The mirrored database ID"),
    },
    async ({ workspaceId, mirroredDatabaseId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.post(`/workspaces/${workspaceId}/mirroredDatabases/${mirroredDatabaseId}/stopMirroring`);
        return { content: [{ type: "text", text: "Mirroring stopped successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "mirrored_database_get_mirroring_status",
    "Get the mirroring status of a mirrored database",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mirroredDatabaseId: z.string().describe("The mirrored database ID"),
    },
    async ({ workspaceId, mirroredDatabaseId }) => {
      try {
        const response = await fabricClient.get(
          `/workspaces/${workspaceId}/mirroredDatabases/${mirroredDatabaseId}/getMirroringStatus`
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "mirrored_database_get_tables_mirroring_status",
    "Get the mirroring status of individual tables in a mirrored database",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mirroredDatabaseId: z.string().describe("The mirrored database ID"),
    },
    async ({ workspaceId, mirroredDatabaseId }) => {
      try {
        const response = await fabricClient.get(
          `/workspaces/${workspaceId}/mirroredDatabases/${mirroredDatabaseId}/getTablesMirroringStatus`
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
