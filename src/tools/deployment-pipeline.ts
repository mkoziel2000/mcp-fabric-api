import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation } from "../core/lro.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";

export function registerDeploymentPipelineTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "deployment_pipeline_list",
    "List all deployment pipelines accessible to the user",
    {},
    async () => {
      try {
        const pipelines = await paginateAll(fabricClient, `/deploymentPipelines`);
        return { content: [{ type: "text", text: JSON.stringify(pipelines, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "deployment_pipeline_get",
    "Get details of a specific deployment pipeline",
    { pipelineId: z.string().describe("The deployment pipeline ID") },
    async ({ pipelineId }) => {
      try {
        const response = await fabricClient.get(`/deploymentPipelines/${pipelineId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "deployment_pipeline_create",
    "Create a new deployment pipeline",
    {
      displayName: z.string().describe("Display name for the deployment pipeline"),
      description: z.string().optional().describe("Description of the deployment pipeline"),
    },
    async ({ displayName, description }) => {
      try {
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        const response = await fabricClient.post(`/deploymentPipelines`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "deployment_pipeline_update",
    "Update a deployment pipeline's name or description",
    {
      pipelineId: z.string().describe("The deployment pipeline ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ pipelineId, displayName, description }) => {
      try {
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/deploymentPipelines/${pipelineId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "deployment_pipeline_delete",
    "Delete a deployment pipeline",
    { pipelineId: z.string().describe("The deployment pipeline ID") },
    async ({ pipelineId }) => {
      try {
        await fabricClient.delete(`/deploymentPipelines/${pipelineId}`);
        return { content: [{ type: "text", text: `Deployment pipeline ${pipelineId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "deployment_pipeline_list_stages",
    "List all stages in a deployment pipeline",
    { pipelineId: z.string().describe("The deployment pipeline ID") },
    async ({ pipelineId }) => {
      try {
        const stages = await paginateAll(fabricClient, `/deploymentPipelines/${pipelineId}/stages`);
        return { content: [{ type: "text", text: JSON.stringify(stages, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "deployment_pipeline_list_stage_items",
    "List all items in a specific deployment pipeline stage",
    {
      pipelineId: z.string().describe("The deployment pipeline ID"),
      stageId: z.string().describe("The stage ID"),
    },
    async ({ pipelineId, stageId }) => {
      try {
        const items = await paginateAll(fabricClient, `/deploymentPipelines/${pipelineId}/stages/${stageId}/items`);
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "deployment_pipeline_assign_workspace",
    "Assign a workspace to a deployment pipeline stage",
    {
      pipelineId: z.string().describe("The deployment pipeline ID"),
      stageId: z.string().describe("The stage ID"),
      workspaceId: z.string().describe("The workspace ID to assign"),
    },
    async ({ pipelineId, stageId, workspaceId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const response = await fabricClient.post(
          `/deploymentPipelines/${pipelineId}/stages/${stageId}/assignWorkspace`,
          { workspaceId }
        );
        return { content: [{ type: "text", text: response.data ? JSON.stringify(response.data, null, 2) : "Workspace assigned to stage successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "deployment_pipeline_unassign_workspace",
    "Unassign a workspace from a deployment pipeline stage",
    {
      pipelineId: z.string().describe("The deployment pipeline ID"),
      stageId: z.string().describe("The stage ID"),
      workspaceId: z.string().describe("The workspace ID to unassign"),
    },
    async ({ pipelineId, stageId, workspaceId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const response = await fabricClient.post(
          `/deploymentPipelines/${pipelineId}/stages/${stageId}/unassignWorkspace`,
          { workspaceId }
        );
        return { content: [{ type: "text", text: response.data ? JSON.stringify(response.data, null, 2) : "Workspace unassigned from stage successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "deployment_pipeline_deploy",
    "Deploy items from one stage to another in a deployment pipeline (long-running)",
    {
      pipelineId: z.string().describe("The deployment pipeline ID"),
      sourceStageId: z.string().describe("The source stage ID to deploy from"),
      targetStageId: z.string().optional().describe("The target stage ID (defaults to the next stage)"),
      items: z.array(z.object({
        sourceItemId: z.string().describe("The source item ID"),
        targetItemId: z.string().optional().describe("The target item ID (for updating existing items)"),
      })).optional().describe("Specific items to deploy (deploys all if omitted)"),
      note: z.string().optional().describe("Deployment note"),
      workspaceId: z.string().optional().describe("The workspace ID (for workspace guard validation)"),
    },
    async ({ pipelineId, sourceStageId, targetStageId, items, note, workspaceId }) => {
      try {
        if (workspaceId) {
          await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        }
        const body: Record<string, unknown> = { sourceStageId };
        if (targetStageId) body.targetStageId = targetStageId;
        if (items) body.items = items;
        if (note) body.note = note;
        const response = await fabricClient.post(`/deploymentPipelines/${pipelineId}/deploy`, body);
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: response.data ? JSON.stringify(response.data, null, 2) : "Deployment initiated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "deployment_pipeline_list_operations",
    "List operations (deployment history) for a deployment pipeline",
    { pipelineId: z.string().describe("The deployment pipeline ID") },
    async ({ pipelineId }) => {
      try {
        const operations = await paginateAll(fabricClient, `/deploymentPipelines/${pipelineId}/operations`);
        return { content: [{ type: "text", text: JSON.stringify(operations, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "deployment_pipeline_get_operation",
    "Get details of a specific deployment pipeline operation",
    {
      pipelineId: z.string().describe("The deployment pipeline ID"),
      operationId: z.string().describe("The operation ID"),
    },
    async ({ pipelineId, operationId }) => {
      try {
        const response = await fabricClient.get(`/deploymentPipelines/${pipelineId}/operations/${operationId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
