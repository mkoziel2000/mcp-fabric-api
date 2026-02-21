import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { decodeBase64, encodeBase64 } from "../utils/base64.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import { resolveContentOrFile, writeFilesToDirectory } from "../utils/file-utils.js";

export function registerEventstreamTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "eventstream_list",
    "List all eventstreams in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const eventstreams = await paginateAll(fabricClient, `/workspaces/${workspaceId}/eventstreams`);
        return { content: [{ type: "text", text: JSON.stringify(eventstreams, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "eventstream_get",
    "Get details of a specific eventstream",
    {
      workspaceId: z.string().describe("The workspace ID"),
      eventstreamId: z.string().describe("The eventstream ID"),
    },
    async ({ workspaceId, eventstreamId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/eventstreams/${eventstreamId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "eventstream_create",
    "Create a new eventstream in a workspace (long-running operation)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the eventstream"),
      description: z.string().optional().describe("Description of the eventstream"),
    },
    async ({ workspaceId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/eventstreams`, body);
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
    "eventstream_update",
    "Update an eventstream's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      eventstreamId: z.string().describe("The eventstream ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, eventstreamId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/eventstreams/${eventstreamId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "eventstream_delete",
    "Delete an eventstream",
    {
      workspaceId: z.string().describe("The workspace ID"),
      eventstreamId: z.string().describe("The eventstream ID"),
    },
    async ({ workspaceId, eventstreamId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/eventstreams/${eventstreamId}`);
        return { content: [{ type: "text", text: `Eventstream ${eventstreamId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "eventstream_get_definition",
    "Get the definition of an eventstream (long-running). Writes definition files to the specified output directory and returns the list of files written.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      eventstreamId: z.string().describe("The eventstream ID"),
      outputDirectoryPath: z.string().describe("Directory path where eventstream definition files will be written"),
    },
    async ({ workspaceId, eventstreamId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/eventstreams/${eventstreamId}/getDefinition`
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
        return { content: [{ type: "text", text: `Eventstream definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "eventstream_update_definition",
    "Update the definition of an eventstream (long-running). Accepts raw content inline or a file path reference.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      eventstreamId: z.string().describe("The eventstream ID"),
      content: z.string().optional().describe("The eventstream definition content (will be base64 encoded)"),
      contentFilePath: z.string().optional().describe("Path to a file containing the eventstream definition (alternative to inline content)"),
      path: z.string().optional().describe("The definition part path (default: eventstream.json)"),
    },
    async ({ workspaceId, eventstreamId, content, contentFilePath, path }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const resolved = await resolveContentOrFile(content, contentFilePath, "content");
        const body = {
          definition: {
            parts: [
              {
                path: path ?? "eventstream.json",
                payload: encodeBase64(resolved),
                payloadType: "InlineBase64",
              },
            ],
          },
        };
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/eventstreams/${eventstreamId}/updateDefinition`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "Eventstream definition updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
