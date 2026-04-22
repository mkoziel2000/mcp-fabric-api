import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "fs/promises";
import { basename, resolve as resolvePath } from "path";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { decodeBase64, encodeBase64 } from "../utils/base64.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import {
  readContentFromFile,
  readFilesFromDirectory,
  writeContentToFile,
  writeFilesToDirectory,
} from "../utils/file-utils.js";

// Tool annotations drive the "enable-all-reads" toggle in client UIs.
// READ: pure reads, safe to allowlist in bulk.
// WRITE: mutations that create/update state.
// DESTRUCTIVE: irreversible or cancelling operations.
const READ = { readOnlyHint: true, destructiveHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

type DefPart = { path: string; payload: string; payloadType: string };

export function registerEnvironmentTools(
  server: McpServer,
  fabricClient: FabricClient,
  workspaceGuard: WorkspaceGuard
) {
  // ─────────────────────────── Item CRUD (read) ───────────────────────────

  server.tool(
    "environment_list",
    "List all environments in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    READ,
    async ({ workspaceId }) => {
      try {
        const envs = await paginateAll(fabricClient, `/workspaces/${workspaceId}/environments`);
        return { content: [{ type: "text", text: JSON.stringify(envs, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "environment_get",
    "Get metadata of a specific environment including its publish state",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
    },
    READ,
    async ({ workspaceId, environmentId }) => {
      try {
        const response = await fabricClient.get(
          `/workspaces/${workspaceId}/environments/${environmentId}`
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "environment_get_definition",
    "Get the environment public definition (long-running). Writes definition files to the specified output directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
      outputDirectoryPath: z
        .string()
        .describe("Directory path where definition files will be written"),
    },
    READ,
    async ({ workspaceId, environmentId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/environments/${environmentId}/getDefinition`
        );
        let parts: DefPart[] | undefined;
        if (response.lro) {
          await pollOperation(fabricClient, response.lro.operationId);
          const result = await getOperationResult<Record<string, unknown>>(
            fabricClient,
            response.lro.operationId
          );
          if (result?.definition) {
            parts = (result.definition as { parts: DefPart[] }).parts;
          }
        }
        if (!parts && response.data?.definition) {
          parts = (response.data.definition as { parts: DefPart[] }).parts;
        }
        if (!parts) {
          return {
            content: [{ type: "text", text: "No definition returned from Fabric API" }],
            isError: true,
          };
        }
        const files = parts.map((part) => ({
          path: part.path,
          content: part.payloadType === "InlineBase64" ? decodeBase64(part.payload) : part.payload,
        }));
        const written = await writeFilesToDirectory(outputDirectoryPath, files);
        return {
          content: [
            {
              type: "text",
              text: `Environment definition written to: ${outputDirectoryPath}\nFiles:\n${written
                .map((f) => `  ${f}`)
                .join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  // ─────────────────────────── Item CRUD (write) ──────────────────────────

  server.tool(
    "environment_create",
    "Create a new environment in a workspace. Optionally seed with a definition by passing definitionDirectoryPath.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the environment"),
      description: z.string().optional().describe("Description of the environment"),
      definitionDirectoryPath: z
        .string()
        .optional()
        .describe("Optional directory containing environment definition files to seed the environment"),
    },
    WRITE,
    async ({ workspaceId, displayName, description, definitionDirectoryPath }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        if (definitionDirectoryPath) {
          const resolved = await readFilesFromDirectory(definitionDirectoryPath);
          body.definition = {
            parts: resolved.map((part) => ({
              path: part.path,
              payload: encodeBase64(part.content),
              payloadType: "InlineBase64",
            })),
          };
        }
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/environments`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          const result = await getOperationResult(fabricClient, response.lro.operationId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ operation: state, item: result ?? response.data }, null, 2),
              },
            ],
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "environment_update",
    "Update an environment's display name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    WRITE,
    async ({ workspaceId, environmentId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(
          `/workspaces/${workspaceId}/environments/${environmentId}`,
          body
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "environment_update_definition",
    "Override the environment public definition (long-running). Reads definition files from the specified directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
      definitionDirectoryPath: z
        .string()
        .describe("Path to a directory containing environment definition files"),
    },
    WRITE,
    async ({ workspaceId, environmentId, definitionDirectoryPath }) => {
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
          `/workspaces/${workspaceId}/environments/${environmentId}/updateDefinition`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "Environment definition updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "environment_delete",
    "Delete an environment",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
    },
    DESTRUCTIVE,
    async ({ workspaceId, environmentId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/environments/${environmentId}`);
        return {
          content: [{ type: "text", text: `Environment ${environmentId} deleted successfully` }],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  // ─────────────────────────── Publish lifecycle ──────────────────────────

  server.tool(
    "environment_publish",
    "Trigger an environment publish to make staging changes effective (long-running)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
    },
    WRITE,
    async ({ workspaceId, environmentId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/environments/${environmentId}/staging/publish?beta=False`
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          const result = await getOperationResult(fabricClient, response.lro.operationId);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ operation: state, result: result ?? response.data }, null, 2),
              },
            ],
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "environment_cancel_publish",
    "Cancel an ongoing environment publish operation",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
    },
    DESTRUCTIVE,
    async ({ workspaceId, environmentId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/environments/${environmentId}/staging/cancelPublish`
        );
        return {
          content: [
            { type: "text", text: JSON.stringify(response.data ?? "Publish cancelled", null, 2) },
          ],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  // ───────────────────────── Staging libraries (read) ─────────────────────

  server.tool(
    "environment_list_staging_libraries",
    "List staging libraries (published + pending) for an environment",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
    },
    READ,
    async ({ workspaceId, environmentId }) => {
      try {
        const libs = await paginateAll(
          fabricClient,
          `/workspaces/${workspaceId}/environments/${environmentId}/staging/libraries?beta=False`,
          "libraries"
        );
        return { content: [{ type: "text", text: JSON.stringify(libs, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "environment_export_staging_external_libraries",
    "Export the staging external libraries as an environment.yml file. Writes the yaml to disk.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
      outputFilePath: z
        .string()
        .describe("File path where the environment.yml content will be written"),
    },
    READ,
    async ({ workspaceId, environmentId, outputFilePath }) => {
      try {
        const response = await fabricClient.get<string>(
          `/workspaces/${workspaceId}/environments/${environmentId}/staging/libraries/exportExternalLibraries`
        );
        const content =
          typeof response.data === "string"
            ? response.data
            : JSON.stringify(response.data, null, 2);
        const written = await writeContentToFile(outputFilePath, content);
        return {
          content: [{ type: "text", text: `Staging external libraries written to: ${written}` }],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  // ───────────────────────── Staging libraries (write) ────────────────────

  server.tool(
    "environment_import_staging_external_libraries",
    "Upload an environment.yml file to replace the environment's external libraries list. Reads yaml from a file.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
      yamlFilePath: z.string().describe("Path to an environment.yml file"),
    },
    WRITE,
    async ({ workspaceId, environmentId, yamlFilePath }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const yaml = await readContentFromFile(yamlFilePath);
        const response = await fabricClient.postBinary(
          `/workspaces/${workspaceId}/environments/${environmentId}/staging/libraries/importExternalLibraries`,
          yaml,
          "application/octet-stream"
        );
        return {
          content: [{ type: "text", text: JSON.stringify(response.data ?? "Imported", null, 2) }],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "environment_upload_staging_custom_library",
    "Upload a custom library file (.jar, .py, .whl, .tar.gz, max 100MB) into environment staging. Reads the file from disk.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
      libraryFilePath: z.string().describe("Path to the library file to upload"),
      libraryName: z
        .string()
        .optional()
        .describe(
          "Library name with extension (e.g., samplelibrary.jar). Defaults to the basename of libraryFilePath."
        ),
    },
    WRITE,
    async ({ workspaceId, environmentId, libraryFilePath, libraryName }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const absolute = resolvePath(libraryFilePath);
        const data = await readFile(absolute);
        const name = libraryName ?? basename(absolute);
        await fabricClient.postBinary(
          `/workspaces/${workspaceId}/environments/${environmentId}/staging/libraries/${encodeURIComponent(name)}`,
          data,
          "application/octet-stream"
        );
        return { content: [{ type: "text", text: `Uploaded ${name} (${data.length} bytes)` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "environment_delete_staging_custom_library",
    "Delete a custom library from environment staging by full filename (e.g., samplelibrary.jar)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
      libraryName: z.string().describe("Full library filename including extension"),
    },
    DESTRUCTIVE,
    async ({ workspaceId, environmentId, libraryName }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(
          `/workspaces/${workspaceId}/environments/${environmentId}/staging/libraries/${encodeURIComponent(libraryName)}`
        );
        return {
          content: [{ type: "text", text: `Custom library ${libraryName} deleted from staging` }],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "environment_remove_staging_external_library",
    "Remove a single external library from environment staging (one at a time)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
      name: z.string().describe("The external library name (e.g., fuzzywuzzy)"),
      version: z.string().describe("The external library version (e.g., 0.0.1)"),
    },
    DESTRUCTIVE,
    async ({ workspaceId, environmentId, name, version }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/environments/${environmentId}/staging/libraries/removeExternalLibrary`,
          { name, version }
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response.data ?? `Removed ${name}@${version}`, null, 2),
            },
          ],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  // ─────────────────────────── Staging Spark compute ──────────────────────

  server.tool(
    "environment_get_staging_spark_compute",
    "Get the staging Spark compute configuration for an environment",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
    },
    READ,
    async ({ workspaceId, environmentId }) => {
      try {
        const response = await fabricClient.get(
          `/workspaces/${workspaceId}/environments/${environmentId}/staging/sparkcompute?beta=False`
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "environment_update_staging_spark_compute",
    "Update the staging Spark compute configuration (pool, cores, memory, runtimeVersion, sparkProperties). Set a sparkProperty value to null to remove it.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
      instancePool: z
        .object({
          name: z.string().describe("Pool name. Use 'Starter Pool' for defaults."),
          type: z.string().optional().describe("Pool type, typically 'Workspace'"),
          id: z.string().optional(),
        })
        .optional(),
      driverCores: z.number().optional(),
      driverMemory: z.string().optional().describe("e.g., '56g'"),
      executorCores: z.number().optional(),
      executorMemory: z.string().optional().describe("e.g., '56g'"),
      dynamicExecutorAllocation: z
        .object({
          enabled: z.boolean(),
          minExecutors: z.number().optional(),
          maxExecutors: z.number().optional(),
        })
        .optional(),
      sparkProperties: z
        .array(z.object({ key: z.string(), value: z.string().nullable() }))
        .optional(),
      runtimeVersion: z.string().optional(),
    },
    WRITE,
    async ({
      workspaceId,
      environmentId,
      instancePool,
      driverCores,
      driverMemory,
      executorCores,
      executorMemory,
      dynamicExecutorAllocation,
      sparkProperties,
      runtimeVersion,
    }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (instancePool !== undefined) body.instancePool = instancePool;
        if (driverCores !== undefined) body.driverCores = driverCores;
        if (driverMemory !== undefined) body.driverMemory = driverMemory;
        if (executorCores !== undefined) body.executorCores = executorCores;
        if (executorMemory !== undefined) body.executorMemory = executorMemory;
        if (dynamicExecutorAllocation !== undefined)
          body.dynamicExecutorAllocation = dynamicExecutorAllocation;
        if (sparkProperties !== undefined) body.sparkProperties = sparkProperties;
        if (runtimeVersion !== undefined) body.runtimeVersion = runtimeVersion;
        const response = await fabricClient.patch(
          `/workspaces/${workspaceId}/environments/${environmentId}/staging/sparkcompute?beta=False`,
          body
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  // ─────────────────────────── Published (effective) ──────────────────────

  server.tool(
    "environment_list_published_libraries",
    "List published (currently effective) libraries for an environment",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
    },
    READ,
    async ({ workspaceId, environmentId }) => {
      try {
        const libs = await paginateAll(
          fabricClient,
          `/workspaces/${workspaceId}/environments/${environmentId}/libraries?beta=False`,
          "libraries"
        );
        return { content: [{ type: "text", text: JSON.stringify(libs, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "environment_get_published_spark_compute",
    "Get the published (currently effective) Spark compute configuration",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
    },
    READ,
    async ({ workspaceId, environmentId }) => {
      try {
        const response = await fabricClient.get(
          `/workspaces/${workspaceId}/environments/${environmentId}/sparkcompute?beta=False`
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "environment_export_published_external_libraries",
    "Export the published external libraries as an environment.yml file. Writes the yaml to disk.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      environmentId: z.string().describe("The environment ID"),
      outputFilePath: z
        .string()
        .describe("File path where the environment.yml content will be written"),
    },
    READ,
    async ({ workspaceId, environmentId, outputFilePath }) => {
      try {
        const response = await fabricClient.get<string>(
          `/workspaces/${workspaceId}/environments/${environmentId}/published/libraries/exportExternalLibraries`
        );
        const content =
          typeof response.data === "string"
            ? response.data
            : JSON.stringify(response.data, null, 2);
        const written = await writeContentToFile(outputFilePath, content);
        return {
          content: [{ type: "text", text: `Published external libraries written to: ${written}` }],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
