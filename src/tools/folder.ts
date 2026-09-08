import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";

const READ = { readOnlyHint: true, destructiveHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

const PREVIEW_NOTE = " (preview API)";

export function registerFolderTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "folder_list",
    `List folders in a workspace, optionally scoped to a subtree${PREVIEW_NOTE}`,
    {
      workspaceId: z.string().describe("The workspace ID"),
      rootFolderId: z.string().optional().describe("Only list folders under this folder (default: the workspace root)"),
      recursive: z.boolean().default(true).describe("List nested subfolders too, not just direct children (default: true)"),
    },
    READ,
    async ({ workspaceId, rootFolderId, recursive }) => {
      try {
        const params = new URLSearchParams();
        if (rootFolderId) params.set("rootFolderId", rootFolderId);
        params.set("recursive", String(recursive));
        const folders = await paginateAll(fabricClient, `/workspaces/${workspaceId}/folders?${params.toString()}`);
        return { content: [{ type: "text", text: JSON.stringify(folders, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "folder_get",
    `Get details of a specific folder${PREVIEW_NOTE}`,
    {
      workspaceId: z.string().describe("The workspace ID"),
      folderId: z.string().describe("The folder ID"),
    },
    READ,
    async ({ workspaceId, folderId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/folders/${folderId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "folder_create",
    `Create a folder in a workspace${PREVIEW_NOTE}`,
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the folder"),
      parentFolderId: z.string().optional().describe("Parent folder ID (default: the workspace root)"),
    },
    WRITE,
    async ({ workspaceId, displayName, parentFolderId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (parentFolderId) body.parentFolderId = parentFolderId;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/folders`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "folder_update",
    `Rename a folder${PREVIEW_NOTE}`,
    {
      workspaceId: z.string().describe("The workspace ID"),
      folderId: z.string().describe("The folder ID"),
      displayName: z.string().describe("New display name"),
    },
    WRITE,
    async ({ workspaceId, folderId, displayName }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/folders/${folderId}`, { displayName });
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "folder_move",
    `Move a folder to a different parent within the same workspace${PREVIEW_NOTE}`,
    {
      workspaceId: z.string().describe("The workspace ID"),
      folderId: z.string().describe("The folder ID to move"),
      targetFolderId: z.string().optional().describe("Destination folder ID (omit to move to the workspace root)"),
    },
    WRITE,
    async ({ workspaceId, folderId, targetFolderId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body = targetFolderId ? { targetFolderId } : {};
        const response = await fabricClient.post(`/workspaces/${workspaceId}/folders/${folderId}/move`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "folder_delete",
    `Delete a folder${PREVIEW_NOTE}`,
    {
      workspaceId: z.string().describe("The workspace ID"),
      folderId: z.string().describe("The folder ID"),
    },
    DESTRUCTIVE,
    async ({ workspaceId, folderId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/folders/${folderId}`);
        return { content: [{ type: "text", text: `Folder ${folderId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
