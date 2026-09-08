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

const READ = { readOnlyHint: true, destructiveHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

export function registerKqlQuerysetTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "kql_queryset_list",
    "List all KQL querysets (saved query tabs against a KQL/Eventhouse database) in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    READ,
    async ({ workspaceId }) => {
      try {
        const items = await paginateAll(fabricClient, `/workspaces/${workspaceId}/kqlQuerysets`);
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "kql_queryset_get",
    "Get details of a specific KQL queryset",
    {
      workspaceId: z.string().describe("The workspace ID"),
      kqlQuerysetId: z.string().describe("The KQL queryset ID"),
    },
    READ,
    async ({ workspaceId, kqlQuerysetId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/kqlQuerysets/${kqlQuerysetId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "kql_queryset_create",
    "Create a new KQL queryset in a workspace (long-running). Optionally seed it with a definition directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the KQL queryset"),
      description: z.string().optional().describe("Description of the KQL queryset"),
      folderId: z.string().optional().describe("Folder ID to create the item in (default: workspace root)"),
      definitionDirectoryPath: z.string().optional().describe("Path to a directory containing KQL queryset definition files"),
    },
    WRITE,
    async ({ workspaceId, displayName, description, folderId, definitionDirectoryPath }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        if (folderId) body.folderId = folderId;
        if (definitionDirectoryPath) {
          const resolved = await resolveFilesOrDirectory(undefined, definitionDirectoryPath);
          body.definition = {
            parts: resolved.map((part) => ({
              path: part.path,
              payload: encodeBase64(part.content),
              payloadType: "InlineBase64",
            })),
          };
        }
        const response = await fabricClient.post(`/workspaces/${workspaceId}/kqlQuerysets`, body);
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
    "kql_queryset_update",
    "Update a KQL queryset's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      kqlQuerysetId: z.string().describe("The KQL queryset ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    WRITE,
    async ({ workspaceId, kqlQuerysetId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/kqlQuerysets/${kqlQuerysetId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "kql_queryset_delete",
    "Delete a KQL queryset",
    {
      workspaceId: z.string().describe("The workspace ID"),
      kqlQuerysetId: z.string().describe("The KQL queryset ID"),
    },
    DESTRUCTIVE,
    async ({ workspaceId, kqlQuerysetId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/kqlQuerysets/${kqlQuerysetId}`);
        return { content: [{ type: "text", text: `KQL queryset ${kqlQuerysetId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "kql_queryset_get_definition",
    "Get the definition of a KQL queryset (long-running). Writes definition files to the specified output directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      kqlQuerysetId: z.string().describe("The KQL queryset ID"),
      outputDirectoryPath: z.string().describe("Directory path where definition files will be written"),
    },
    READ,
    async ({ workspaceId, kqlQuerysetId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/kqlQuerysets/${kqlQuerysetId}/getDefinition`
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
        return { content: [{ type: "text", text: `KQL queryset definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "kql_queryset_update_definition",
    "Update a KQL queryset's definition (long-running). Accepts definition parts inline or a directory path.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      kqlQuerysetId: z.string().describe("The KQL queryset ID"),
      parts: z.array(z.object({
        path: z.string().describe("The definition part path"),
        content: z.string().describe("The file content as a string"),
      })).optional().describe("Array of definition parts to upload"),
      partsDirectoryPath: z.string().optional().describe("Path to a directory containing definition files"),
    },
    WRITE,
    async ({ workspaceId, kqlQuerysetId, parts, partsDirectoryPath }) => {
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
          `/workspaces/${workspaceId}/kqlQuerysets/${kqlQuerysetId}/updateDefinition`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "KQL queryset definition updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
