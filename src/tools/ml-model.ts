import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";

export function registerMlModelTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "ml_model_list",
    "List all ML models in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const models = await paginateAll(fabricClient, `/workspaces/${workspaceId}/mlModels`);
        return { content: [{ type: "text", text: JSON.stringify(models, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "ml_model_get",
    "Get details of a specific ML model",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mlModelId: z.string().describe("The ML model ID"),
    },
    async ({ workspaceId, mlModelId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/mlModels/${mlModelId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "ml_model_create",
    "Create a new ML model in a workspace (long-running)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the ML model"),
      description: z.string().optional().describe("Description of the ML model"),
    },
    async ({ workspaceId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/mlModels`, body);
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
    "ml_model_update",
    "Update an ML model's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mlModelId: z.string().describe("The ML model ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, mlModelId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/mlModels/${mlModelId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "ml_model_delete",
    "Delete an ML model",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mlModelId: z.string().describe("The ML model ID"),
    },
    async ({ workspaceId, mlModelId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/mlModels/${mlModelId}`);
        return { content: [{ type: "text", text: `ML model ${mlModelId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
