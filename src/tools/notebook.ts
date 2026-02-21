import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { runOnDemandJob, getJobInstance, cancelJobInstance } from "../core/job-scheduler.js";
import { decodeBase64, encodeBase64 } from "../utils/base64.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import { resolveContentOrFile } from "../utils/file-utils.js";

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
    "Get the content/definition of a notebook (long-running, returns decoded content)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      notebookId: z.string().describe("The notebook ID"),
    },
    async ({ workspaceId, notebookId }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/notebooks/${notebookId}/getDefinition`
        );
        if (response.lro) {
          await pollOperation(fabricClient, response.lro.operationId);
          const result = await getOperationResult<Record<string, unknown>>(fabricClient, response.lro.operationId);
          if (result?.definition) {
            const definition = result.definition as { parts: Array<{ path: string; payload: string; payloadType: string }> };
            const decoded = definition.parts.map((part) => ({
              path: part.path,
              payload: part.payloadType === "InlineBase64" ? decodeBase64(part.payload) : part.payload,
              payloadType: part.payloadType,
            }));
            return { content: [{ type: "text", text: JSON.stringify(decoded, null, 2) }] };
          }
        }
        const data = response.data;
        if (data?.definition) {
          const definition = data.definition as { parts: Array<{ path: string; payload: string; payloadType: string }> };
          const decoded = definition.parts.map((part) => ({
            path: part.path,
            payload: part.payloadType === "InlineBase64" ? decodeBase64(part.payload) : part.payload,
            payloadType: part.payloadType,
          }));
          return { content: [{ type: "text", text: JSON.stringify(decoded, null, 2) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "notebook_update_definition",
    "Update the content/definition of a notebook (long-running). Accepts raw content inline or a file path reference.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      notebookId: z.string().describe("The notebook ID"),
      content: z.string().optional().describe("The notebook content (will be base64 encoded)"),
      contentFilePath: z.string().optional().describe("Path to a file containing the notebook content (alternative to inline content)"),
      path: z.string().optional().describe("The definition part path (default: notebook-content.py)"),
    },
    async ({ workspaceId, notebookId, content, contentFilePath, path }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const resolved = await resolveContentOrFile(content, contentFilePath, "content");
        const body = {
          definition: {
            parts: [
              {
                path: path ?? "notebook-content.py",
                payload: encodeBase64(resolved),
                payloadType: "InlineBase64",
              },
            ],
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
