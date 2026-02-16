import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";

export function registerWorkspaceTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "workspace_list",
    "List all accessible Fabric workspaces",
    {},
    async () => {
      try {
        const workspaces = await paginateAll(fabricClient, "/workspaces");
        return { content: [{ type: "text", text: JSON.stringify(workspaces, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "workspace_get",
    "Get details of a specific workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "workspace_create",
    "Create a new Fabric workspace",
    {
      displayName: z.string().describe("Display name for the workspace"),
      description: z.string().optional().describe("Description of the workspace"),
      capacityId: z.string().optional().describe("Capacity ID to assign"),
    },
    async ({ displayName, description, capacityId }) => {
      try {
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        if (capacityId) body.capacityId = capacityId;
        const response = await fabricClient.post("/workspaces", body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "workspace_update",
    "Update a workspace's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "workspace_delete",
    "Delete a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}`);
        return { content: [{ type: "text", text: `Workspace ${workspaceId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "workspace_list_items",
    "List all items in a workspace, optionally filtered by type",
    {
      workspaceId: z.string().describe("The workspace ID"),
      type: z.string().optional().describe("Filter by item type (e.g., Lakehouse, Notebook, Pipeline)"),
    },
    async ({ workspaceId, type }) => {
      try {
        let path = `/workspaces/${workspaceId}/items`;
        if (type) path += `?type=${type}`;
        const items = await paginateAll(fabricClient, path);
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
