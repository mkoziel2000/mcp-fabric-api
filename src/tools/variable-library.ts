import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { encodeBase64, decodeBase64 } from "../utils/base64.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import { readFilesFromDirectory, writeFilesToDirectory } from "../utils/file-utils.js";

interface DefinitionPart {
  path: string;
  payload: string;
  payloadType: string;
}

export function registerVariableLibraryTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "variable_library_list",
    "List all variable libraries in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const items = await paginateAll(fabricClient, `/workspaces/${workspaceId}/VariableLibraries`);
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "variable_library_get",
    "Get details of a specific variable library, including its active value set name",
    {
      workspaceId: z.string().describe("The workspace ID"),
      variableLibraryId: z.string().describe("The variable library ID"),
    },
    async ({ workspaceId, variableLibraryId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/VariableLibraries/${variableLibraryId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "variable_library_create",
    "Create a new variable library in a workspace (long-running). Optionally provide a directory containing the definition files (variables.json, settings.json, valueSets/*.json).",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the variable library"),
      description: z.string().optional().describe("Description of the variable library (max 256 characters)"),
      definitionDirectoryPath: z.string().optional().describe("Path to a directory containing definition files (variables.json, settings.json, valueSets/*.json, .platform)"),
    },
    async ({ workspaceId, displayName, description, definitionDirectoryPath }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        if (definitionDirectoryPath) {
          const files = await readFilesFromDirectory(definitionDirectoryPath, [".json", ".platform"]);
          const parts = files.map((f) => ({
            path: f.path,
            payload: encodeBase64(f.content),
            payloadType: "InlineBase64",
          }));
          body.definition = { format: "VariableLibraryV1", parts };
        }
        const response = await fabricClient.post(`/workspaces/${workspaceId}/VariableLibraries`, body);
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
    "variable_library_update",
    "Update a variable library's name, description, or active value set",
    {
      workspaceId: z.string().describe("The workspace ID"),
      variableLibraryId: z.string().describe("The variable library ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description (max 256 characters)"),
      activeValueSetName: z.string().optional().describe("Name of the value set to make active"),
    },
    async ({ workspaceId, variableLibraryId, displayName, description, activeValueSetName }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        if (activeValueSetName !== undefined) body.properties = { activeValueSetName };
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/VariableLibraries/${variableLibraryId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "variable_library_delete",
    "Delete a variable library",
    {
      workspaceId: z.string().describe("The workspace ID"),
      variableLibraryId: z.string().describe("The variable library ID"),
    },
    async ({ workspaceId, variableLibraryId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/VariableLibraries/${variableLibraryId}`);
        return { content: [{ type: "text", text: `Variable library ${variableLibraryId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "variable_library_get_definition",
    "Get the definition of a variable library (long-running). Writes all definition files (variables.json, settings.json, valueSets/*.json, .platform) to the specified output directory and returns the list of files written.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      variableLibraryId: z.string().describe("The variable library ID"),
      outputDirectoryPath: z.string().describe("Directory path where definition files will be written"),
    },
    async ({ workspaceId, variableLibraryId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/VariableLibraries/${variableLibraryId}/getDefinition`
        );
        let parts: DefinitionPart[] | undefined;
        if (response.lro) {
          await pollOperation(fabricClient, response.lro.operationId);
          const result = await getOperationResult<Record<string, unknown>>(fabricClient, response.lro.operationId);
          if (result?.definition) {
            parts = (result.definition as { parts: DefinitionPart[] }).parts;
          }
        }
        if (!parts && response.data?.definition) {
          parts = (response.data.definition as { parts: DefinitionPart[] }).parts;
        }
        if (!parts) {
          return { content: [{ type: "text", text: "No definition returned from Fabric API" }], isError: true };
        }
        const files = parts.map((part) => ({
          path: part.path,
          content: part.payloadType === "InlineBase64" ? decodeBase64(part.payload) : part.payload,
        }));
        const written = await writeFilesToDirectory(outputDirectoryPath, files);
        return { content: [{ type: "text", text: `Variable library definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "variable_library_update_definition",
    "Update a variable library's definition (long-running). Reads definition files (variables.json, settings.json, valueSets/*.json, .platform) from the specified directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      variableLibraryId: z.string().describe("The variable library ID"),
      definitionDirectoryPath: z.string().describe("Path to a directory containing definition files (variables.json, settings.json, valueSets/*.json, .platform)"),
    },
    async ({ workspaceId, variableLibraryId, definitionDirectoryPath }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const files = await readFilesFromDirectory(definitionDirectoryPath, [".json", ".platform"]);
        const parts = files.map((f) => ({
          path: f.path,
          payload: encodeBase64(f.content),
          payloadType: "InlineBase64",
        }));
        const body = { definition: { parts } };
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/VariableLibraries/${variableLibraryId}/updateDefinition`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "Variable library definition updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
