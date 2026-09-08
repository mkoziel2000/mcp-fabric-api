import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";

const READ = { readOnlyHint: true, destructiveHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

const PERMISSION_SCOPE = z.object({
  attributeName: z.enum(["Path", "Action"]).describe("'Path' scopes by location (e.g. 'Tables/mytable' or '*'); 'Action' scopes by access type (e.g. 'Read')"),
  attributeValueIncludedIn: z.array(z.string()).describe("Values for the attribute, e.g. ['Tables/sales'] for Path or ['Read'] for Action"),
});

const DECISION_RULE = z.object({
  effect: z.literal("Permit").default("Permit").describe("Currently only 'Permit' is supported"),
  permission: z.array(PERMISSION_SCOPE).describe("Exactly two entries: one Path scope and one Action scope"),
  constraints: z.object({
    columns: z.array(z.object({
      tablePath: z.string().describe("e.g. '/Tables/schema/mytable'"),
      columnNames: z.array(z.string()).describe("Case-sensitive column names, or ['*'] for all columns"),
      columnEffect: z.literal("Permit").default("Permit"),
      columnAction: z.array(z.literal("Read")).default(["Read"]),
    })).optional().describe("Column-level security restrictions"),
    rows: z.array(z.object({
      tablePath: z.string().describe("e.g. '/Tables/schema/mytable'"),
      value: z.string().describe("T-SQL predicate, e.g. \"select * from Table where Region='West'\""),
    })).optional().describe("Row-level security predicates"),
  }).optional().describe("Optional row/column-level constraints applied on top of the path/action permission"),
});

const MEMBERS = z.object({
  fabricItemMembers: z.array(z.object({
    sourcePath: z.string().describe("'{workspaceId}/{itemId}' of a Fabric item — all its members with the given access are included"),
    itemAccess: z.array(z.enum(["Read", "Write", "Reshare", "Explore", "Execute", "ReadAll"])).describe("Access levels on the source item that qualify a user as a role member"),
  })).optional(),
  microsoftEntraMembers: z.array(z.object({
    tenantId: z.string().describe("Microsoft Entra tenant ID"),
    objectId: z.string().describe("Microsoft Entra object ID of the user, group, service principal, or managed identity"),
    objectType: z.enum(["Group", "User", "ServicePrincipal", "ManagedIdentity"]),
  })).optional(),
}).optional().describe("Who is granted this role. If omitted, the role has no members.");

export function registerOneLakeDataAccessTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "onelake_list_data_access_roles",
    "List OneLake data access roles (table/folder-level read permissions) defined on a Fabric item, typically a Lakehouse (preview API)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      itemId: z.string().describe("The item ID (typically a Lakehouse)"),
    },
    READ,
    async ({ workspaceId, itemId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/items/${itemId}/dataAccessRoles?preview=true`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "onelake_get_data_access_role",
    "Get details of a specific OneLake data access role by name (preview API)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      itemId: z.string().describe("The item ID (typically a Lakehouse)"),
      roleName: z.string().describe("The role name"),
    },
    READ,
    async ({ workspaceId, itemId, roleName }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/items/${itemId}/dataAccessRoles/${encodeURIComponent(roleName)}?preview=true`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "onelake_set_data_access_role",
    "Create or update (upsert) a single OneLake data access role on a Fabric item, typically a Lakehouse, without touching other roles on the item (preview API). " +
    "Restricts which files/folders/tables a role's members can read, optionally with row- or column-level constraints.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      itemId: z.string().describe("The item ID (typically a Lakehouse)"),
      name: z.string().describe("The role name (create if new, replace if it already exists)"),
      decisionRules: z.array(DECISION_RULE).describe("Permissions that make up this role"),
      members: MEMBERS,
      conflictPolicy: z.enum(["Overwrite", "Abort"]).default("Overwrite").describe("Overwrite replaces an existing role of the same name; Abort fails instead"),
    },
    WRITE,
    async ({ workspaceId, itemId, name, decisionRules, members, conflictPolicy }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { name, kind: "Policy", decisionRules };
        if (members) body.members = members;
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/items/${itemId}/dataAccessRoles?dataAccessRoleConflictPolicy=${conflictPolicy}`,
          body
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data ?? { name, status: "applied" }, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "onelake_delete_data_access_role",
    "Delete a OneLake data access role from a Fabric item by name (preview API)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      itemId: z.string().describe("The item ID (typically a Lakehouse)"),
      roleName: z.string().describe("The role name to delete"),
    },
    DESTRUCTIVE,
    async ({ workspaceId, itemId, roleName }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/items/${itemId}/dataAccessRoles/${encodeURIComponent(roleName)}?preview=true`);
        return { content: [{ type: "text", text: `Data access role "${roleName}" deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
