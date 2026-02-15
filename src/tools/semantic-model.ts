import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { PowerBIClient } from "../client/powerbi-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { encodeBase64, decodeBase64 } from "../utils/base64.js";
import { decodeTmdlParts, encodeTmdlParts, formatTmdlOutput } from "../utils/tmdl.js";
import type { DefinitionPart } from "../utils/tmdl.js";

export function registerSemanticModelTools(server: McpServer, fabricClient: FabricClient, powerBIClient: PowerBIClient) {
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
    "semantic_model_get",
    "Get details of a specific semantic model",
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
    "semantic_model_create",
    "Create a new semantic model with a BIM/JSON definition (long-running). Accepts the raw model.bim JSON string as the definition.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the semantic model"),
      description: z.string().optional().describe("Description of the semantic model"),
      definition: z.string().describe("The full model.bim JSON content as a string"),
    },
    async ({ workspaceId, displayName, description, definition }) => {
      try {
        const body: Record<string, unknown> = {
          displayName,
          definition: {
            parts: [
              {
                path: "definition/model.bim",
                payload: encodeBase64(definition),
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
    "Create a new semantic model with a TMDL definition (long-running). Accepts an array of TMDL files with path and content as the definition.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the semantic model"),
      description: z.string().optional().describe("Description of the semantic model"),
      files: z.array(z.object({
        path: z.string().describe("The TMDL file path (e.g., 'model.tmdl', 'definition/tables/Sales.tmdl')"),
        content: z.string().describe("The TMDL file content"),
      })).describe("Array of TMDL files for the initial definition"),
    },
    async ({ workspaceId, displayName, description, files }) => {
      try {
        const body: Record<string, unknown> = {
          displayName,
          definition: {
            parts: encodeTmdlParts(files),
          },
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
    "semantic_model_update",
    "Update a semantic model's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      semanticModelId: z.string().describe("The semantic model ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, semanticModelId, displayName, description }) => {
      try {
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
    "semantic_model_get_definition",
    "Get the full definition of a semantic model in TMSL/BIM JSON format (long-running, returns decoded model.bim)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      semanticModelId: z.string().describe("The semantic model ID"),
    },
    async ({ workspaceId, semanticModelId }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/semanticModels/${semanticModelId}/getDefinition`
        );
        if (response.lro) {
          await pollOperation(fabricClient, response.lro.operationId);
          const result = await getOperationResult<Record<string, unknown>>(fabricClient, response.lro.operationId);
          if (result?.definition) {
            const definition = result.definition as { parts: DefinitionPart[] };
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
          const definition = data.definition as { parts: DefinitionPart[] };
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
    "semantic_model_get_tmdl",
    "Get the definition of a semantic model in TMDL format (human-readable, LLM-friendly). Returns all TMDL files (model.tmdl, tables/*.tmdl, etc.) as decoded text.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      semanticModelId: z.string().describe("The semantic model ID"),
    },
    async ({ workspaceId, semanticModelId }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/semanticModels/${semanticModelId}/getDefinition?format=TMDL`
        );
        if (response.lro) {
          await pollOperation(fabricClient, response.lro.operationId);
          const result = await getOperationResult<Record<string, unknown>>(fabricClient, response.lro.operationId);
          if (result?.definition) {
            const definition = result.definition as { parts: DefinitionPart[] };
            const files = decodeTmdlParts(definition.parts);
            return { content: [{ type: "text", text: formatTmdlOutput(files) }] };
          }
        }
        const data = response.data;
        if (data?.definition) {
          const definition = data.definition as { parts: DefinitionPart[] };
          const files = decodeTmdlParts(definition.parts);
          return { content: [{ type: "text", text: formatTmdlOutput(files) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "semantic_model_update_definition",
    "Update a semantic model's full definition from TMSL/BIM JSON (long-running). Accepts the raw model.bim JSON string.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      semanticModelId: z.string().describe("The semantic model ID"),
      definition: z.string().describe("The full model.bim JSON content as a string"),
    },
    async ({ workspaceId, semanticModelId, definition }) => {
      try {
        const body = {
          definition: {
            parts: [
              {
                path: "definition/model.bim",
                payload: encodeBase64(definition),
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
    "Update a semantic model's definition from TMDL files (long-running). Accepts an array of TMDL files with path and content. This is the primary tool for LLMs to create/modify semantic models.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      semanticModelId: z.string().describe("The semantic model ID"),
      files: z.array(z.object({
        path: z.string().describe("The TMDL file path (e.g., 'model.tmdl', 'definition/tables/Sales.tmdl')"),
        content: z.string().describe("The TMDL file content"),
      })).describe("Array of TMDL files to upload"),
    },
    async ({ workspaceId, semanticModelId, files }) => {
      try {
        const body = {
          definition: {
            parts: encodeTmdlParts(files),
          },
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
}
