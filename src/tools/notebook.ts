import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { runOnDemandJob, getJobInstance, cancelJobInstance } from "../core/job-scheduler.js";
import { decodeBase64, encodeBase64 } from "../utils/base64.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import { readFilesFromDirectory, writeFilesToDirectory } from "../utils/file-utils.js";

export function registerNotebookTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "notebook_list",
    "List all notebooks in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const notebooks = await paginateAll(fabricClient, `/workspaces/${workspaceId}/notebooks`);
        return { content: [{ type: "text", text: JSON.stringify(notebooks, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "notebook_get",
    "Get details of a specific notebook",
    {
      workspaceId: z.string().describe("The workspace ID"),
      notebookId: z.string().describe("The notebook ID"),
    },
    async ({ workspaceId, notebookId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/notebooks/${notebookId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "notebook_create",
    "Create a new notebook in a workspace (long-running operation)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the notebook"),
      description: z.string().optional().describe("Description of the notebook"),
    },
    async ({ workspaceId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/notebooks`, body);
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
    "notebook_update",
    "Update a notebook's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      notebookId: z.string().describe("The notebook ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, notebookId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/notebooks/${notebookId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "notebook_delete",
    "Delete a notebook",
    {
      workspaceId: z.string().describe("The workspace ID"),
      notebookId: z.string().describe("The notebook ID"),
    },
    async ({ workspaceId, notebookId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/notebooks/${notebookId}`);
        return { content: [{ type: "text", text: `Notebook ${notebookId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "notebook_get_definition",
    "Get the content/definition of a notebook (long-running). Writes definition files to the specified output directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      notebookId: z.string().describe("The notebook ID"),
      outputDirectoryPath: z.string().describe("Directory path where notebook definition files will be written"),
    },
    async ({ workspaceId, notebookId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/notebooks/${notebookId}/getDefinition`
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
        return { content: [{ type: "text", text: `Notebook definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "notebook_update_definition",
    "Update the content/definition of a notebook (long-running). Reads definition files from the specified directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      notebookId: z.string().describe("The notebook ID"),
      definitionDirectoryPath: z.string().describe("Path to a directory containing notebook definition files"),
    },
    async ({ workspaceId, notebookId, definitionDirectoryPath }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const resolved = await readFilesFromDirectory(definitionDirectoryPath);
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
          `/workspaces/${workspaceId}/notebooks/${notebookId}/updateDefinition`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "Notebook definition updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "notebook_run",
    "Run a notebook on demand",
    {
      workspaceId: z.string().describe("The workspace ID"),
      notebookId: z.string().describe("The notebook ID"),
      parameters: z.record(z.unknown()).optional().describe("Notebook parameters as key-value pairs"),
    },
    async ({ workspaceId, notebookId, parameters }) => {
      try {
        const executionData = parameters ? { parameters } : undefined;
        const job = await runOnDemandJob(fabricClient, workspaceId, notebookId, "RunNotebook", executionData);
        return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "notebook_get_run_status",
    "Get the status of a notebook run",
    {
      workspaceId: z.string().describe("The workspace ID"),
      notebookId: z.string().describe("The notebook ID"),
      jobInstanceId: z.string().describe("The job instance ID from notebook_run"),
    },
    async ({ workspaceId, notebookId, jobInstanceId }) => {
      try {
        const job = await getJobInstance(fabricClient, workspaceId, notebookId, jobInstanceId);
        return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "notebook_cancel_run",
    "Cancel a running notebook execution",
    {
      workspaceId: z.string().describe("The workspace ID"),
      notebookId: z.string().describe("The notebook ID"),
      jobInstanceId: z.string().describe("The job instance ID to cancel"),
    },
    async ({ workspaceId, notebookId, jobInstanceId }) => {
      try {
        await cancelJobInstance(fabricClient, workspaceId, notebookId, jobInstanceId);
        return { content: [{ type: "text", text: `Notebook run ${jobInstanceId} cancelled successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
