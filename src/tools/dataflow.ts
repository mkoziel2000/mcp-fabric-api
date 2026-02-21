import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { decodeBase64 } from "../utils/base64.js";
import { runOnDemandJob, getJobInstance, cancelJobInstance } from "../core/job-scheduler.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import { writeFilesToDirectory } from "../utils/file-utils.js";

export function registerDataflowTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "dataflow_list",
    "List all Dataflow Gen2 items in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const items = await paginateAll(fabricClient, `/workspaces/${workspaceId}/items?type=DataflowGen2`);
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "dataflow_get",
    "Get details of a specific Dataflow Gen2 item",
    {
      workspaceId: z.string().describe("The workspace ID"),
      dataflowId: z.string().describe("The dataflow ID"),
    },
    async ({ workspaceId, dataflowId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/items/${dataflowId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "dataflow_create",
    "Create a new Dataflow Gen2 item in a workspace",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the dataflow"),
      description: z.string().optional().describe("Description of the dataflow"),
    },
    async ({ workspaceId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName, type: "DataflowGen2" };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/items`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "dataflow_update",
    "Update a Dataflow Gen2 item's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      dataflowId: z.string().describe("The dataflow ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, dataflowId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/items/${dataflowId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "dataflow_delete",
    "Delete a Dataflow Gen2 item",
    {
      workspaceId: z.string().describe("The workspace ID"),
      dataflowId: z.string().describe("The dataflow ID"),
    },
    async ({ workspaceId, dataflowId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/items/${dataflowId}`);
        return { content: [{ type: "text", text: `Dataflow ${dataflowId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "dataflow_refresh",
    "Trigger a refresh of a Dataflow Gen2 item",
    {
      workspaceId: z.string().describe("The workspace ID"),
      dataflowId: z.string().describe("The dataflow ID"),
    },
    async ({ workspaceId, dataflowId }) => {
      try {
        const job = await runOnDemandJob(fabricClient, workspaceId, dataflowId, "Refresh");
        return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "dataflow_get_refresh_status",
    "Get the status of a dataflow refresh job",
    {
      workspaceId: z.string().describe("The workspace ID"),
      dataflowId: z.string().describe("The dataflow ID"),
      jobInstanceId: z.string().describe("The job instance ID from dataflow_refresh"),
    },
    async ({ workspaceId, dataflowId, jobInstanceId }) => {
      try {
        const job = await getJobInstance(fabricClient, workspaceId, dataflowId, jobInstanceId);
        return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "dataflow_get_definition",
    "Get the definition of a Dataflow Gen2 item (long-running). Writes definition files to the specified output directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      dataflowId: z.string().describe("The dataflow ID"),
      outputDirectoryPath: z.string().describe("Directory path where definition files will be written"),
    },
    async ({ workspaceId, dataflowId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/items/${dataflowId}/getDefinition`
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
        return { content: [{ type: "text", text: `Dataflow definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
