import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";

const READ = { readOnlyHint: true, destructiveHint: false } as const;

export function registerCatalogTools(server: McpServer, fabricClient: FabricClient) {
  server.tool(
    "catalog_search",
    "Search for Fabric items across every workspace the caller can access, without needing to know which workspace they're in (preview API). " +
    "Searches display name, workspace display name, and description. " +
    "Use the filter to narrow by item type, e.g. \"Type eq 'Report' or Type eq 'Lakehouse'\".",
    {
      search: z.string().optional().describe("Text query to search for"),
      filter: z.string().optional().describe("OData-style filter, e.g. \"Type eq 'Lakehouse'\" (supports eq, ne, or, and parentheses)"),
      pageSize: z.number().min(1).max(1000).optional().describe("Number of results per page (1-1000)"),
      continuationToken: z.string().optional().describe("Continuation token from a previous search to fetch the next page"),
    },
    READ,
    async ({ search, filter, pageSize, continuationToken }) => {
      try {
        const body: Record<string, unknown> = {};
        if (search) body.search = search;
        if (filter) body.filter = filter;
        if (pageSize) body.pageSize = pageSize;
        if (continuationToken) body.continuationToken = continuationToken;
        const response = await fabricClient.post("/catalog/search", body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
