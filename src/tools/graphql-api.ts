import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { PowerBIClient } from "../client/powerbi-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { decodeBase64 } from "../utils/base64.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import { writeFilesToDirectory } from "../utils/file-utils.js";

export function registerGraphQLApiTools(server: McpServer, fabricClient: FabricClient, powerBIClient: PowerBIClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "graphql_api_list",
    "List all GraphQL API items in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const items = await paginateAll(fabricClient, `/workspaces/${workspaceId}/graphQLApis`);
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "graphql_api_get",
    "Get details of a specific GraphQL API item",
    {
      workspaceId: z.string().describe("The workspace ID"),
      graphqlApiId: z.string().describe("The GraphQL API ID"),
    },
    async ({ workspaceId, graphqlApiId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/graphQLApis/${graphqlApiId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "graphql_api_create",
    "Create a new GraphQL API item in a workspace",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the GraphQL API"),
      description: z.string().optional().describe("Description of the GraphQL API"),
    },
    async ({ workspaceId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/graphQLApis`, body);
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
    "graphql_api_update",
    "Update a GraphQL API item's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      graphqlApiId: z.string().describe("The GraphQL API ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, graphqlApiId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/graphQLApis/${graphqlApiId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "graphql_api_delete",
    "Delete a GraphQL API item",
    {
      workspaceId: z.string().describe("The workspace ID"),
      graphqlApiId: z.string().describe("The GraphQL API ID"),
    },
    async ({ workspaceId, graphqlApiId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/graphQLApis/${graphqlApiId}`);
        return { content: [{ type: "text", text: `GraphQL API ${graphqlApiId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "graphql_api_get_definition",
    "Get the GraphQL schema definition of a GraphQL API item (long-running). Writes definition files (.graphql, etc.) to the specified output directory and returns the list of files written.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      graphqlApiId: z.string().describe("The GraphQL API ID"),
      outputDirectoryPath: z.string().describe("Directory path where GraphQL definition files will be written"),
    },
    async ({ workspaceId, graphqlApiId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/graphQLApis/${graphqlApiId}/getDefinition`
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
        return { content: [{ type: "text", text: `GraphQL API definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "graphql_api_execute_query",
    "Execute a GraphQL query against a GraphQL API endpoint. Uses the Power BI scope token.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      graphqlApiId: z.string().describe("The GraphQL API ID"),
      query: z.string().describe("The GraphQL query string"),
      variables: z.record(z.unknown()).optional().describe("GraphQL query variables"),
    },
    async ({ workspaceId, graphqlApiId, query, variables }) => {
      try {
        const body: Record<string, unknown> = { query };
        if (variables) body.variables = variables;
        // GraphQL API endpoint uses the Fabric base URL with Power BI scope
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/graphQLApis/${graphqlApiId}/graphql`,
          body
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
