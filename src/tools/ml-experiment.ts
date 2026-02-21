import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";

export function registerMlExperimentTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "ml_experiment_list",
    "List all ML experiments in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const experiments = await paginateAll(fabricClient, `/workspaces/${workspaceId}/mlExperiments`);
        return { content: [{ type: "text", text: JSON.stringify(experiments, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "ml_experiment_get",
    "Get details of a specific ML experiment",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mlExperimentId: z.string().describe("The ML experiment ID"),
    },
    async ({ workspaceId, mlExperimentId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/mlExperiments/${mlExperimentId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "ml_experiment_create",
    "Create a new ML experiment in a workspace (long-running)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the ML experiment"),
      description: z.string().optional().describe("Description of the ML experiment"),
    },
    async ({ workspaceId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/mlExperiments`, body);
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
    "ml_experiment_update",
    "Update an ML experiment's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mlExperimentId: z.string().describe("The ML experiment ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, mlExperimentId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/mlExperiments/${mlExperimentId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "ml_experiment_delete",
    "Delete an ML experiment",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mlExperimentId: z.string().describe("The ML experiment ID"),
    },
    async ({ workspaceId, mlExperimentId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/mlExperiments/${mlExperimentId}`);
        return { content: [{ type: "text", text: `ML experiment ${mlExperimentId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
