import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";

const READ = { readOnlyHint: true, destructiveHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

export function registerWorkspaceTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "workspace_list",
    "List all accessible Fabric workspaces",
    {},
    READ,
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
    READ,
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
    WRITE,
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
    WRITE,
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
    DESTRUCTIVE,
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
    READ,
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

  const PRINCIPAL_TYPE = z.enum(["User", "Group", "ServicePrincipal", "ServicePrincipalProfile", "EntireTenant"]);
  const WORKSPACE_ROLE = z.enum(["Admin", "Member", "Contributor", "Viewer"]);

  server.tool(
    "workspace_list_role_assignments",
    "List all role assignments (who has Admin/Member/Contributor/Viewer access) for a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    READ,
    async ({ workspaceId }) => {
      try {
        const assignments = await paginateAll(fabricClient, `/workspaces/${workspaceId}/roleAssignments`);
        return { content: [{ type: "text", text: JSON.stringify(assignments, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "workspace_get_role_assignment",
    "Get a specific workspace role assignment by its ID",
    {
      workspaceId: z.string().describe("The workspace ID"),
      workspaceRoleAssignmentId: z.string().describe("The role assignment ID"),
    },
    READ,
    async ({ workspaceId, workspaceRoleAssignmentId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/roleAssignments/${workspaceRoleAssignmentId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "workspace_add_role_assignment",
    "Grant a principal (user, group, service principal, or the entire tenant) a role on a workspace",
    {
      workspaceId: z.string().describe("The workspace ID"),
      principalId: z.string().describe("The principal's Microsoft Entra object ID (or tenant ID for an EntireTenant principal)"),
      principalType: PRINCIPAL_TYPE.describe("The type of principal"),
      role: WORKSPACE_ROLE.describe("The workspace role to grant"),
    },
    WRITE,
    async ({ workspaceId, principalId, principalType, role }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body = { principal: { id: principalId, type: principalType }, role };
        const response = await fabricClient.post(`/workspaces/${workspaceId}/roleAssignments`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "workspace_update_role_assignment",
    "Change the role of an existing workspace role assignment",
    {
      workspaceId: z.string().describe("The workspace ID"),
      workspaceRoleAssignmentId: z.string().describe("The role assignment ID"),
      role: WORKSPACE_ROLE.describe("The new workspace role"),
    },
    WRITE,
    async ({ workspaceId, workspaceRoleAssignmentId, role }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/roleAssignments/${workspaceRoleAssignmentId}`, { role });
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "workspace_delete_role_assignment",
    "Remove a principal's role assignment from a workspace",
    {
      workspaceId: z.string().describe("The workspace ID"),
      workspaceRoleAssignmentId: z.string().describe("The role assignment ID"),
    },
    DESTRUCTIVE,
    async ({ workspaceId, workspaceRoleAssignmentId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/roleAssignments/${workspaceRoleAssignmentId}`);
        return { content: [{ type: "text", text: `Role assignment ${workspaceRoleAssignmentId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
