import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";

const READ = { readOnlyHint: true, destructiveHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

export function registerTagTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "tag_list",
    "List all tags defined in the tenant (tenant-wide and domain-scoped)",
    {},
    READ,
    async () => {
      try {
        const tags = await paginateAll(fabricClient, "/tags");
        return { content: [{ type: "text", text: JSON.stringify(tags, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "item_apply_tags",
    "Apply one or more existing tags to a workspace item",
    {
      workspaceId: z.string().describe("The workspace ID"),
      itemId: z.string().describe("The item ID"),
      tagIds: z.array(z.string()).describe("Tag IDs to apply (from tag_list)"),
    },
    WRITE,
    async ({ workspaceId, itemId, tagIds }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.post(`/workspaces/${workspaceId}/items/${itemId}/applyTags`, { tags: tagIds });
        return { content: [{ type: "text", text: `Applied ${tagIds.length} tag(s) to item ${itemId}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "item_unapply_tags",
    "Remove one or more tags from a workspace item",
    {
      workspaceId: z.string().describe("The workspace ID"),
      itemId: z.string().describe("The item ID"),
      tagIds: z.array(z.string()).describe("Tag IDs to remove"),
    },
    DESTRUCTIVE,
    async ({ workspaceId, itemId, tagIds }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.post(`/workspaces/${workspaceId}/items/${itemId}/unapplyTags`, { tags: tagIds });
        return { content: [{ type: "text", text: `Removed ${tagIds.length} tag(s) from item ${itemId}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
