import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { PowerBIClient } from "../client/powerbi-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { encodeBase64, decodeBase64 } from "../utils/base64.js";
import { decodeTmdlParts, encodeTmdlParts } from "../utils/tmdl.js";
import type { DefinitionPart } from "../utils/tmdl.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import { readContentFromFile, readFilesFromDirectory, writeContentToFile, writeFilesToDirectory } from "../utils/file-utils.js";

export function registerSemanticModelTools(server: McpServer, fabricClient: FabricClient, powerBIClient: PowerBIClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "semantic_model_list",
    "List all semantic models in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const models = await paginateAll(fabricClient, `/workspaces/${workspaceId}/semanticModels`);
        return { content: [{ type: "text", text: JSON.stringify(models, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "semantic_model_get_details",
    "Get details (name, ID, description, etc.) of a specific semantic model — does not return the definition",
    {
      workspaceId: z.string().describe("The workspace ID"),
      semanticModelId: z.string().describe("The semantic model ID"),
    },
    async ({ workspaceId, semanticModelId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/semanticModels/${semanticModelId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "semantic_model_create_bim",
    "Create a new semantic model with a BIM/JSON definition (long-running). Reads the model.bim JSON from the specified file path.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the semantic model"),
      description: z.string().optional().describe("Description of the semantic model"),
      definitionFilePath: z.string().describe("Path to a file containing the model.bim JSON"),
    },
    async ({ workspaceId, displayName, description, definitionFilePath }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const resolved = await readContentFromFile(definitionFilePath);
        const body: Record<string, unknown> = {
          displayName,
          definition: {
            parts: [
              {
                path: "model.bim",
                payload: encodeBase64(resolved),
                payloadType: "InlineBase64",
              },
              {
                path: "definition.pbism",
                payload: encodeBase64(JSON.stringify({ version: "1.0", settings: {} })),
                payloadType: "InlineBase64",
              },
            ],
          },
        };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/semanticModels`, body);
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
    "semantic_model_create_tmdl",
    "Create a new semantic model with a TMDL definition (long-running). Reads .tmdl and .pbism files from the specified directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the semantic model"),
      description: z.string().optional().describe("Description of the semantic model"),
      filesDirectoryPath: z.string().describe("Path to a directory containing .tmdl and .pbism files"),
    },
    async ({ workspaceId, displayName, description, filesDirectoryPath }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const resolved = await readFilesFromDirectory(filesDirectoryPath, [".tmdl", ".pbism"]);
        const parts = encodeTmdlParts(resolved);
        if (!resolved.some((f) => f.path === "definition.pbism")) {
          parts.push({
            path: "definition.pbism",
            payload: Buffer.from(JSON.stringify({ version: "4.0", settings: {} }), "utf-8").toString("base64"),
            payloadType: "InlineBase64",
          });
        }
        const body: Record<string, unknown> = {
          displayName,
          definition: { parts },
        };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/semanticModels?format=TMDL`, body);
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
    "semantic_model_update_details",
    "Update a semantic model's name or description — does not modify the definition",
    {
      workspaceId: z.string().describe("The workspace ID"),
      semanticModelId: z.string().describe("The semantic model ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, semanticModelId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/semanticModels/${semanticModelId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "semantic_model_delete",
    "Delete a semantic model",
    {
      workspaceId: z.string().describe("The workspace ID"),
      semanticModelId: z.string().describe("The semantic model ID"),
    },
    async ({ workspaceId, semanticModelId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/semanticModels/${semanticModelId}`);
        return { content: [{ type: "text", text: `Semantic model ${semanticModelId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "semantic_model_refresh",
    "Trigger a refresh of a semantic model via the Power BI API",
    {
      workspaceId: z.string().describe("The workspace ID (Power BI group ID)"),
      semanticModelId: z.string().describe("The semantic model/dataset ID"),
    },
    async ({ workspaceId, semanticModelId }) => {
      try {
        const response = await powerBIClient.post(
          `/groups/${workspaceId}/datasets/${semanticModelId}/refreshes`,
          { notifyOption: "NoNotification" }
        );
        return { content: [{ type: "text", text: JSON.stringify({ message: "Refresh triggered successfully", status: response.status }, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "semantic_model_execute_dax",
    "Execute a DAX query against a semantic model via the Power BI API",
    {
      workspaceId: z.string().describe("The workspace ID (Power BI group ID)"),
      semanticModelId: z.string().describe("The semantic model/dataset ID"),
      query: z.string().describe("The DAX query to execute (e.g., 'EVALUATE Sales')"),
    },
    async ({ workspaceId, semanticModelId, query }) => {
      try {
        const response = await powerBIClient.post<Record<string, unknown>>(
          `/groups/${workspaceId}/datasets/${semanticModelId}/executeQueries`,
          {
            queries: [{ query }],
            serializerSettings: { includeNulls: true },
          }
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "semantic_model_get_bim",
    "Get the full definition of a semantic model in TMSL/BIM JSON format (long-running). Writes the decoded model.bim to the specified output file path and returns the path.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      semanticModelId: z.string().describe("The semantic model ID"),
      outputFilePath: z.string().describe("File path where the model.bim JSON will be written"),
    },
    async ({ workspaceId, semanticModelId, outputFilePath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/semanticModels/${semanticModelId}/getDefinition`
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
        const bimPart = parts.find((p) => p.path === "model.bim");
        if (!bimPart) {
          return { content: [{ type: "text", text: "No model.bim found in definition parts" }], isError: true };
        }
        const decoded = bimPart.payloadType === "InlineBase64" ? decodeBase64(bimPart.payload) : bimPart.payload;
        const writtenPath = await writeContentToFile(outputFilePath, decoded);
        return { content: [{ type: "text", text: `Definition written to: ${writtenPath}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "semantic_model_get_tmdl",
    "Get the definition of a semantic model in TMDL format (human-readable, LLM-friendly). Writes all TMDL files to the specified output directory preserving the folder structure and returns the list of files written.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      semanticModelId: z.string().describe("The semantic model ID"),
      outputDirectoryPath: z.string().describe("Directory path where TMDL files will be written"),
    },
    async ({ workspaceId, semanticModelId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/semanticModels/${semanticModelId}/getDefinition?format=TMDL`
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
        const files = decodeTmdlParts(parts);
        const written = await writeFilesToDirectory(outputDirectoryPath, files);
        return { content: [{ type: "text", text: `TMDL definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "semantic_model_update_bim",
    "Update a semantic model's full definition from TMSL/BIM JSON (long-running). Reads the model.bim JSON from the specified file path.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      semanticModelId: z.string().describe("The semantic model ID"),
      definitionFilePath: z.string().describe("Path to a file containing the model.bim JSON"),
    },
    async ({ workspaceId, semanticModelId, definitionFilePath }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const resolved = await readContentFromFile(definitionFilePath);
        const body = {
          definition: {
            parts: [
              {
                path: "model.bim",
                payload: encodeBase64(resolved),
                payloadType: "InlineBase64",
              },
              {
                path: "definition.pbism",
                payload: encodeBase64(JSON.stringify({ version: "1.0", settings: {} })),
                payloadType: "InlineBase64",
              },
            ],
          },
        };
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/semanticModels/${semanticModelId}/updateDefinition`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "Semantic model definition updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "semantic_model_update_tmdl",
    "Update a semantic model's definition from TMDL files (long-running). Reads .tmdl and .pbism files from the specified directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      semanticModelId: z.string().describe("The semantic model ID"),
      filesDirectoryPath: z.string().describe("Path to a directory containing .tmdl and .pbism files"),
    },
    async ({ workspaceId, semanticModelId, filesDirectoryPath }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const resolved = await readFilesFromDirectory(filesDirectoryPath, [".tmdl", ".pbism"]);
        const parts = encodeTmdlParts(resolved);
        if (!resolved.some((f) => f.path === "definition.pbism")) {
          parts.push({
            path: "definition.pbism",
            payload: Buffer.from(JSON.stringify({ version: "4.0", settings: {} }), "utf-8").toString("base64"),
            payloadType: "InlineBase64",
          });
        }
        const body = {
          definition: { parts },
        };
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/semanticModels/${semanticModelId}/updateDefinition?format=TMDL`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "Semantic model TMDL definition updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "semantic_model_get_refresh_history",
    "Get the refresh history of a semantic model via the Power BI API",
    {
      workspaceId: z.string().describe("The workspace ID (Power BI group ID)"),
      semanticModelId: z.string().describe("The semantic model/dataset ID"),
    },
    async ({ workspaceId, semanticModelId }) => {
      try {
        const response = await powerBIClient.get(
          `/groups/${workspaceId}/datasets/${semanticModelId}/refreshes`
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "semantic_model_take_over",
    "Take over ownership of a semantic model via the Power BI API",
    {
      workspaceId: z.string().describe("The workspace ID (Power BI group ID)"),
      semanticModelId: z.string().describe("The semantic model/dataset ID"),
    },
    async ({ workspaceId, semanticModelId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await powerBIClient.post(
          `/groups/${workspaceId}/datasets/${semanticModelId}/Default.TakeOver`
        );
        return { content: [{ type: "text", text: `Successfully took over ownership of semantic model ${semanticModelId}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "semantic_model_get_datasources",
    "Get the data sources of a semantic model via the Power BI API",
    {
      workspaceId: z.string().describe("The workspace ID (Power BI group ID)"),
      semanticModelId: z.string().describe("The semantic model/dataset ID"),
    },
    async ({ workspaceId, semanticModelId }) => {
      try {
        const response = await powerBIClient.get(
          `/groups/${workspaceId}/datasets/${semanticModelId}/datasources`
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
