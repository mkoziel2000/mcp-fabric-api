import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { encodeBase64, decodeBase64 } from "../utils/base64.js";
import { runOnDemandJob, getJobInstance, cancelJobInstance, listJobInstances } from "../core/job-scheduler.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import { resolveFilesOrDirectory, writeFilesToDirectory } from "../utils/file-utils.js";
import type { FileEntry } from "../utils/file-utils.js";

export function registerPipelineTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "pipeline_list",
    "List all data pipelines in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const pipelines = await paginateAll(fabricClient, `/workspaces/${workspaceId}/dataPipelines`);
        return { content: [{ type: "text", text: JSON.stringify(pipelines, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "pipeline_get",
    "Get details of a specific data pipeline",
    {
      workspaceId: z.string().describe("The workspace ID"),
      pipelineId: z.string().describe("The pipeline ID"),
    },
    async ({ workspaceId, pipelineId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/dataPipelines/${pipelineId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "pipeline_create",
    "Create a new data pipeline in a workspace",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the pipeline"),
      description: z.string().optional().describe("Description of the pipeline"),
    },
    async ({ workspaceId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/dataPipelines`, body);
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
    "pipeline_update",
    "Update a pipeline's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      pipelineId: z.string().describe("The pipeline ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, pipelineId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/dataPipelines/${pipelineId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "pipeline_delete",
    "Delete a data pipeline",
    {
      workspaceId: z.string().describe("The workspace ID"),
      pipelineId: z.string().describe("The pipeline ID"),
    },
    async ({ workspaceId, pipelineId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/dataPipelines/${pipelineId}`);
        return { content: [{ type: "text", text: `Pipeline ${pipelineId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "pipeline_run",
    "Run a data pipeline on demand",
    {
      workspaceId: z.string().describe("The workspace ID"),
      pipelineId: z.string().describe("The pipeline ID"),
      parameters: z.record(z.unknown()).optional().describe("Pipeline parameters as key-value pairs"),
    },
    async ({ workspaceId, pipelineId, parameters }) => {
      try {
        const executionData = parameters ? { parameters } : undefined;
        const job = await runOnDemandJob(fabricClient, workspaceId, pipelineId, "Pipeline", executionData);
        return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "pipeline_get_run_status",
    "Get the status of a pipeline run",
    {
      workspaceId: z.string().describe("The workspace ID"),
      pipelineId: z.string().describe("The pipeline ID"),
      jobInstanceId: z.string().describe("The job instance ID from pipeline_run"),
    },
    async ({ workspaceId, pipelineId, jobInstanceId }) => {
      try {
        const job = await getJobInstance(fabricClient, workspaceId, pipelineId, jobInstanceId);
        return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "pipeline_cancel_run",
    "Cancel a running pipeline execution",
    {
      workspaceId: z.string().describe("The workspace ID"),
      pipelineId: z.string().describe("The pipeline ID"),
      jobInstanceId: z.string().describe("The job instance ID to cancel"),
    },
    async ({ workspaceId, pipelineId, jobInstanceId }) => {
      try {
        await cancelJobInstance(fabricClient, workspaceId, pipelineId, jobInstanceId);
        return { content: [{ type: "text", text: `Pipeline run ${jobInstanceId} cancelled successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "pipeline_list_runs",
    "List all run instances for a pipeline",
    {
      workspaceId: z.string().describe("The workspace ID"),
      pipelineId: z.string().describe("The pipeline ID"),
    },
    async ({ workspaceId, pipelineId }) => {
      try {
        const jobs = await listJobInstances(fabricClient, workspaceId, pipelineId);
        return { content: [{ type: "text", text: JSON.stringify(jobs, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  // Schedule tools
  server.tool(
    "pipeline_list_schedules",
    "List all schedules for a pipeline",
    {
      workspaceId: z.string().describe("The workspace ID"),
      pipelineId: z.string().describe("The pipeline ID"),
    },
    async ({ workspaceId, pipelineId }) => {
      try {
        const response = await fabricClient.get(
          `/workspaces/${workspaceId}/items/${pipelineId}/jobSchedules`
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "pipeline_create_schedule",
    "Create a schedule for a pipeline",
    {
      workspaceId: z.string().describe("The workspace ID"),
      pipelineId: z.string().describe("The pipeline ID"),
      startDateTime: z.string().describe("Schedule start date/time (ISO 8601)"),
      endDateTime: z.string().optional().describe("Schedule end date/time (ISO 8601)"),
      localTimeZoneId: z.string().optional().describe("Time zone ID (e.g., 'Eastern Standard Time')"),
      type: z.enum(["Once", "Daily", "Weekly", "Monthly"]).describe("Schedule type"),
      interval: z.number().optional().describe("Interval between runs"),
      weekDays: z.array(z.string()).optional().describe("Days of the week for weekly schedules"),
      times: z.array(z.string()).optional().describe("Times of day for the schedule (HH:mm format)"),
      enabled: z.boolean().optional().describe("Whether the schedule is enabled (default: true)"),
    },
    async ({ workspaceId, pipelineId, startDateTime, endDateTime, localTimeZoneId, type, interval, weekDays, times, enabled }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const configuration: Record<string, unknown> = { type, startDateTime };
        if (endDateTime) configuration.endDateTime = endDateTime;
        if (localTimeZoneId) configuration.localTimeZoneId = localTimeZoneId;
        if (interval) configuration.interval = interval;
        if (weekDays) configuration.weekDays = weekDays;
        if (times) configuration.times = times;

        const body = {
          enabled: enabled ?? true,
          configuration,
        };
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/items/${pipelineId}/jobSchedules`,
          body
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "pipeline_update_schedule",
    "Update an existing pipeline schedule",
    {
      workspaceId: z.string().describe("The workspace ID"),
      pipelineId: z.string().describe("The pipeline ID"),
      scheduleId: z.string().describe("The schedule ID to update"),
      enabled: z.boolean().optional().describe("Whether the schedule is enabled"),
      configuration: z.record(z.unknown()).optional().describe("Updated schedule configuration"),
    },
    async ({ workspaceId, pipelineId, scheduleId, enabled, configuration }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (enabled !== undefined) body.enabled = enabled;
        if (configuration) body.configuration = configuration;
        const response = await fabricClient.patch(
          `/workspaces/${workspaceId}/items/${pipelineId}/jobSchedules/${scheduleId}`,
          body
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "pipeline_delete_schedule",
    "Delete a pipeline schedule",
    {
      workspaceId: z.string().describe("The workspace ID"),
      pipelineId: z.string().describe("The pipeline ID"),
      scheduleId: z.string().describe("The schedule ID to delete"),
    },
    async ({ workspaceId, pipelineId, scheduleId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(
          `/workspaces/${workspaceId}/items/${pipelineId}/jobSchedules/${scheduleId}`
        );
        return { content: [{ type: "text", text: `Schedule ${scheduleId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "pipeline_get_definition",
    "Get the definition of a data pipeline (long-running). Writes definition files to the specified output directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      pipelineId: z.string().describe("The pipeline ID"),
      outputDirectoryPath: z.string().describe("Directory path where definition files will be written"),
    },
    async ({ workspaceId, pipelineId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/dataPipelines/${pipelineId}/getDefinition`
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
        return { content: [{ type: "text", text: `Pipeline definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "pipeline_update_definition",
    "Update a data pipeline's definition (long-running). Accepts definition parts inline or a directory path.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      pipelineId: z.string().describe("The pipeline ID"),
      parts: z.array(z.object({
        path: z.string().describe("The definition part path"),
        content: z.string().describe("The file content as a string"),
      })).optional().describe("Array of definition parts to upload"),
      partsDirectoryPath: z.string().optional().describe("Path to a directory containing definition files"),
    },
    async ({ workspaceId, pipelineId, parts, partsDirectoryPath }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const resolved: FileEntry[] = await resolveFilesOrDirectory(parts, partsDirectoryPath);
        const body = {
          definition: {
            parts: resolved.map((part) => ({
              path: part.path,
              payload: encodeBase64(part.content),
              payloadType: "InlineBase64",
            })),
          },
        };
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/dataPipelines/${pipelineId}/updateDefinition`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "Pipeline definition updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
