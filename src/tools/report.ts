import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { PowerBIClient } from "../client/powerbi-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { encodeBase64, decodeBase64 } from "../utils/base64.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import { resolveFilesOrDirectory, writeFilesToDirectory } from "../utils/file-utils.js";
import type { FileEntry } from "../utils/file-utils.js";

export function registerReportTools(server: McpServer, fabricClient: FabricClient, powerBIClient: PowerBIClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "report_list",
    "List all reports in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const reports = await paginateAll(fabricClient, `/workspaces/${workspaceId}/reports`);
        return { content: [{ type: "text", text: JSON.stringify(reports, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "report_get",
    "Get details of a specific report",
    {
      workspaceId: z.string().describe("The workspace ID"),
      reportId: z.string().describe("The report ID"),
    },
    async ({ workspaceId, reportId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/reports/${reportId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "report_create",
    "Create a new report in a workspace (long-running operation)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the report"),
      description: z.string().optional().describe("Description of the report"),
    },
    async ({ workspaceId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/reports`, body);
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
    "report_update",
    "Update a report's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      reportId: z.string().describe("The report ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, reportId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/reports/${reportId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "report_delete",
    "Delete a report",
    {
      workspaceId: z.string().describe("The workspace ID"),
      reportId: z.string().describe("The report ID"),
    },
    async ({ workspaceId, reportId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/reports/${reportId}`);
        return { content: [{ type: "text", text: `Report ${reportId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "report_clone",
    "Clone a report via the Power BI API",
    {
      workspaceId: z.string().describe("The source workspace ID"),
      reportId: z.string().describe("The report ID to clone"),
      name: z.string().describe("Name for the cloned report"),
      targetWorkspaceId: z.string().optional().describe("Target workspace ID (default: same workspace)"),
      targetModelId: z.string().optional().describe("Target semantic model/dataset ID"),
    },
    async ({ workspaceId, reportId, name, targetWorkspaceId, targetModelId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, targetWorkspaceId ?? workspaceId);
        const body: Record<string, unknown> = { name };
        if (targetWorkspaceId) body.targetWorkspaceId = targetWorkspaceId;
        if (targetModelId) body.targetModelId = targetModelId;
        const response = await powerBIClient.post(
          `/groups/${workspaceId}/reports/${reportId}/Clone`,
          body
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "report_export",
    "Export a report to a file format (PDF, PPTX, PNG, etc.) via the Power BI API. Returns an export ID to check status.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      reportId: z.string().describe("The report ID to export"),
      format: z.enum(["PDF", "PPTX", "PNG", "XLSX", "DOCX", "CSV", "XML", "MHTML", "IMAGE", "ACCESSIBLEPDF"]).describe("Export format"),
    },
    async ({ workspaceId, reportId, format }) => {
      try {
        const response = await powerBIClient.post<Record<string, unknown>>(
          `/groups/${workspaceId}/reports/${reportId}/ExportTo`,
          { format }
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "report_get_export_status",
    "Get the status of a report export operation via the Power BI API",
    {
      workspaceId: z.string().describe("The workspace ID"),
      reportId: z.string().describe("The report ID"),
      exportId: z.string().describe("The export ID from report_export"),
    },
    async ({ workspaceId, reportId, exportId }) => {
      try {
        const response = await powerBIClient.get(
          `/groups/${workspaceId}/reports/${reportId}/exports/${exportId}`
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "report_get_definition",
    "Get the full definition of a report (PBIR or PBIR-Legacy format). Writes all definition files (report.json, pages, visuals, etc.) to the specified output directory and returns the list of files written.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      reportId: z.string().describe("The report ID"),
      outputDirectoryPath: z.string().describe("Directory path where report definition files will be written"),
    },
    async ({ workspaceId, reportId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/reports/${reportId}/getDefinition`
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
        return { content: [{ type: "text", text: `Report definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "report_update_definition",
    "Update a report's full definition (PBIR or PBIR-Legacy). Accepts an array of definition parts inline or a directory path containing definition files.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      reportId: z.string().describe("The report ID"),
      parts: z.array(z.object({
        path: z.string().describe("The definition part path (e.g., 'definition/report.json', 'definition/pages/pages.json', 'definition.pbir')"),
        content: z.string().describe("The file content as a string"),
      })).optional().describe("Array of definition parts to upload"),
      partsDirectoryPath: z.string().optional().describe("Path to a directory containing report definition files (alternative to inline parts)"),
    },
    async ({ workspaceId, reportId, parts, partsDirectoryPath }) => {
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
          `/workspaces/${workspaceId}/reports/${reportId}/updateDefinition`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "Report definition updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "report_rebind",
    "Rebind a report to a different semantic model/dataset via the Power BI API",
    {
      workspaceId: z.string().describe("The workspace ID"),
      reportId: z.string().describe("The report ID"),
      datasetId: z.string().describe("The target semantic model/dataset ID to rebind to"),
    },
    async ({ workspaceId, reportId, datasetId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await powerBIClient.post(
          `/groups/${workspaceId}/reports/${reportId}/Rebind`,
          { datasetId }
        );
        return { content: [{ type: "text", text: `Report ${reportId} rebound to dataset ${datasetId} successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "report_get_pages",
    "Get the list of pages in a report via the Power BI API",
    {
      workspaceId: z.string().describe("The workspace ID"),
      reportId: z.string().describe("The report ID"),
    },
    async ({ workspaceId, reportId }) => {
      try {
        const response = await powerBIClient.get(
          `/groups/${workspaceId}/reports/${reportId}/pages`
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "report_get_datasources",
    "Get the data sources used by a report via the Power BI API",
    {
      workspaceId: z.string().describe("The workspace ID"),
      reportId: z.string().describe("The report ID"),
    },
    async ({ workspaceId, reportId }) => {
      try {
        const response = await powerBIClient.get(
          `/groups/${workspaceId}/reports/${reportId}/datasources`
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
