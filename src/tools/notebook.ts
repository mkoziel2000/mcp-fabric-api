import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { runOnDemandJob, getJobInstance, cancelJobInstance } from "../core/job-scheduler.js";
import { decodeBase64, encodeBase64 } from "../utils/base64.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import { readFilesFromDirectory, writeFilesToDirectory, writeContentToFile } from "../utils/file-utils.js";

const READ = { readOnlyHint: true, destructiveHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

type DefPart = { path: string; payload: string; payloadType: string };
type Dependencies = Record<string, unknown> & {
  environment?: { environmentId: string; workspaceId: string };
};

async function fetchNotebookDefinitionParts(
  fabricClient: FabricClient,
  workspaceId: string,
  notebookId: string
): Promise<DefPart[]> {
  const response = await fabricClient.post<Record<string, unknown>>(
    `/workspaces/${workspaceId}/notebooks/${notebookId}/getDefinition`
  );
  if (response.lro) {
    await pollOperation(fabricClient, response.lro.operationId);
    const result = await getOperationResult<Record<string, unknown>>(
      fabricClient,
      response.lro.operationId
    );
    const def = result?.definition as { parts?: DefPart[] } | undefined;
    if (def?.parts) return def.parts;
  }
  const def = response.data?.definition as { parts?: DefPart[] } | undefined;
  if (def?.parts) return def.parts;
  throw new Error("No definition returned from Fabric API");
}

function rewriteIpynbDependencies(
  content: string,
  mutate: (deps: Dependencies) => void
): string {
  const nb = JSON.parse(content) as { metadata?: { dependencies?: Dependencies } };
  nb.metadata = nb.metadata ?? {};
  nb.metadata.dependencies = nb.metadata.dependencies ?? {};
  mutate(nb.metadata.dependencies);
  return JSON.stringify(nb, null, 2);
}

// Fabric .py notebooks wrap a JSON metadata block in `# META ` comment lines.
function rewritePyDependencies(
  content: string,
  mutate: (deps: Dependencies) => void
): string {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => /^# META \{/.test(l));
  if (start === -1) throw new Error("Notebook .py has no `# META` metadata block");
  let end = start;
  while (end < lines.length && /^# META(\s|$)/.test(lines[end])) end++;
  const jsonStr = lines
    .slice(start, end)
    .map((l) => l.replace(/^# META ?/, ""))
    .join("\n");
  const meta = JSON.parse(jsonStr) as { dependencies?: Dependencies };
  meta.dependencies = meta.dependencies ?? {};
  mutate(meta.dependencies);
  const newJson = JSON.stringify(meta, null, 2)
    .split("\n")
    .map((l) => (l.length === 0 ? "# META" : `# META ${l}`));
  return [...lines.slice(0, start), ...newJson, ...lines.slice(end)].join("\n");
}

async function updateNotebookDependencies(
  fabricClient: FabricClient,
  workspaceId: string,
  notebookId: string,
  mutate: (deps: Dependencies) => void
): Promise<void> {
  const parts = await fetchNotebookDefinitionParts(fabricClient, workspaceId, notebookId);
  const idx = parts.findIndex(
    (p) => p.path.endsWith("notebook-content.py") || p.path.endsWith("notebook-content.ipynb")
  );
  if (idx === -1) throw new Error("No notebook-content part found in definition");
  const part = parts[idx];
  const raw =
    part.payloadType === "InlineBase64" ? decodeBase64(part.payload) : part.payload;
  const rewritten = part.path.endsWith(".ipynb")
    ? rewriteIpynbDependencies(raw, mutate)
    : rewritePyDependencies(raw, mutate);
  parts[idx] = {
    path: part.path,
    payload: encodeBase64(rewritten),
    payloadType: "InlineBase64",
  };
  const response = await fabricClient.post(
    `/workspaces/${workspaceId}/notebooks/${notebookId}/updateDefinition`,
    { definition: { parts } }
  );
  if (response.lro) {
    await pollOperation(fabricClient, response.lro.operationId);
  }
}

export function registerNotebookTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "notebook_list",
    "List all notebooks in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    READ,
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
    READ,
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
    WRITE,
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
    WRITE,
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
    DESTRUCTIVE,
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
    READ,
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
    WRITE,
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
    WRITE,
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
    READ,
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
    DESTRUCTIVE,
    async ({ workspaceId, notebookId, jobInstanceId }) => {
      try {
        await cancelJobInstance(fabricClient, workspaceId, notebookId, jobInstanceId);
        return { content: [{ type: "text", text: `Notebook run ${jobInstanceId} cancelled successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "notebook_list_livy_sessions",
    "List Spark Livy sessions for a notebook (session/application state, compute sizing, durations). Does not include cell output — use notebook_get_livy_log for driver/executor logs.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      notebookId: z.string().describe("The notebook ID"),
    },
    READ,
    async ({ workspaceId, notebookId }) => {
      try {
        const sessions = await paginateAll(fabricClient, `/workspaces/${workspaceId}/notebooks/${notebookId}/livySessions`);
        return { content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "notebook_get_livy_session",
    "Get details of a specific Spark Livy session for a notebook (state, sparkApplicationId, compute sizing, durations, cancellation reason)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      notebookId: z.string().describe("The notebook ID"),
      livyId: z.string().describe("The Livy session ID (from notebook_list_livy_sessions or a LivySession's jobInstanceId lookup)"),
    },
    READ,
    async ({ workspaceId, notebookId, livyId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/notebooks/${notebookId}/livySessions/${livyId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "notebook_get_livy_log",
    "Download the Livy, driver, or executor log for a notebook's Spark session to local disk. The driver log is the closest thing to notebook 'results' available via API — printed/displayed output and stack traces land there as unstructured text; there is no API for structured per-cell output.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      notebookId: z.string().describe("The notebook ID"),
      livyId: z.string().describe("The Livy session ID (from notebook_list_livy_sessions)"),
      logType: z.enum(["livy", "driver", "executor"]).default("livy").describe("Which log to fetch: livy (session lifecycle), driver (stdout/stderr — where print/display output lands), or executor"),
      outputFilePath: z.string().describe("Local file path to write the log content to"),
    },
    READ,
    async ({ workspaceId, notebookId, livyId, logType, outputFilePath }) => {
      try {
        const response = await fabricClient.get<unknown>(
          `/workspaces/${workspaceId}/notebooks/${notebookId}/livySessions/${livyId}/applications/none/logs?type=${logType}`
        );
        const content = typeof response.data === "string" ? response.data : JSON.stringify(response.data, null, 2);
        const written = await writeContentToFile(outputFilePath, content);
        return { content: [{ type: "text", text: `${logType} log (${content.length} bytes) written to ${written}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "notebook_attach_environment",
    "Attach a Fabric Environment to a notebook so it uses that environment's compute/libraries. Mutates the notebook definition metadata (no local files involved).",
    {
      workspaceId: z.string().describe("The workspace ID where the notebook lives"),
      notebookId: z.string().describe("The notebook ID"),
      environmentId: z.string().describe("The environment ID to attach"),
      environmentWorkspaceId: z
        .string()
        .optional()
        .describe("Workspace ID of the environment (defaults to the notebook's workspaceId)"),
    },
    WRITE,
    async ({ workspaceId, notebookId, environmentId, environmentWorkspaceId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const envWs = environmentWorkspaceId ?? workspaceId;
        await updateNotebookDependencies(fabricClient, workspaceId, notebookId, (deps) => {
          deps.environment = { environmentId, workspaceId: envWs };
        });
        return {
          content: [
            {
              type: "text",
              text: `Environment ${environmentId} (workspace ${envWs}) attached to notebook ${notebookId}`,
            },
          ],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "notebook_detach_environment",
    "Remove the attached environment from a notebook by deleting the environment binding from its definition metadata.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      notebookId: z.string().describe("The notebook ID"),
    },
    DESTRUCTIVE,
    async ({ workspaceId, notebookId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await updateNotebookDependencies(fabricClient, workspaceId, notebookId, (deps) => {
          delete deps.environment;
        });
        return {
          content: [{ type: "text", text: `Environment detached from notebook ${notebookId}` }],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
