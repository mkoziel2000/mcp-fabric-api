import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { decodeBase64 } from "../utils/base64.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import { writeFilesToDirectory } from "../utils/file-utils.js";

export function registerReflexTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "reflex_list",
    "List all Reflex (Activator) items in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const items = await paginateAll(fabricClient, `/workspaces/${workspaceId}/items?type=Reflex`);
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "reflex_get",
    "Get details of a specific Reflex (Activator) item",
    {
      workspaceId: z.string().describe("The workspace ID"),
      reflexId: z.string().describe("The reflex/activator ID"),
    },
    async ({ workspaceId, reflexId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/items/${reflexId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "reflex_create",
    "Create a new Reflex (Activator) item in a workspace",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the reflex"),
      description: z.string().optional().describe("Description of the reflex"),
    },
    async ({ workspaceId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName, type: "Reflex" };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/items`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "reflex_update",
    "Update a Reflex (Activator) item's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      reflexId: z.string().describe("The reflex/activator ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, reflexId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/items/${reflexId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "reflex_delete",
    "Delete a Reflex (Activator) item",
    {
      workspaceId: z.string().describe("The workspace ID"),
      reflexId: z.string().describe("The reflex/activator ID"),
    },
    async ({ workspaceId, reflexId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/items/${reflexId}`);
        return { content: [{ type: "text", text: `Reflex ${reflexId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "reflex_get_definition",
    "Get the definition of a Reflex (Activator) item (long-running). Writes definition files to the specified output directory and returns the list of files written.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      reflexId: z.string().describe("The reflex/activator ID"),
      outputDirectoryPath: z.string().describe("Directory path where Reflex definition files will be written"),
    },
    async ({ workspaceId, reflexId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/items/${reflexId}/getDefinition`
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
        return { content: [{ type: "text", text: `Reflex definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
