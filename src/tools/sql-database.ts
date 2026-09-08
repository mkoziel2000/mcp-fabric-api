import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { paginateAll } from "../core/pagination.js";
import { pollOperation, getOperationResult } from "../core/lro.js";
import { encodeBase64, decodeBase64 } from "../utils/base64.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import { resolveFilesOrDirectory, writeFilesToDirectory } from "../utils/file-utils.js";
import type { FileEntry } from "../utils/file-utils.js";

const READ = { readOnlyHint: true, destructiveHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

export function registerSqlDatabaseTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "sql_database_list",
    "List all SQL databases in a workspace (Fabric's native transactional SQL database item, distinct from Warehouse)",
    { workspaceId: z.string().describe("The workspace ID") },
    READ,
    async ({ workspaceId }) => {
      try {
        const items = await paginateAll(fabricClient, `/workspaces/${workspaceId}/sqlDatabases`);
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "sql_database_get",
    "Get details of a specific SQL database, including its connection string",
    {
      workspaceId: z.string().describe("The workspace ID"),
      sqlDatabaseId: z.string().describe("The SQL database ID"),
    },
    READ,
    async ({ workspaceId, sqlDatabaseId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/sqlDatabases/${sqlDatabaseId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "sql_database_create",
    "Create a new SQL database in a workspace (long-running). Can create a fresh database, or restore from a source database / a restorable deleted database via creationPayload.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the SQL database"),
      description: z.string().optional().describe("Description of the SQL database"),
      folderId: z.string().optional().describe("Folder ID to create the database in (default: workspace root)"),
      creationPayload: z.record(z.unknown()).optional().describe(
        "Optional creation mode payload. New: { creationMode: 'New', backupRetentionDays?, collation? }. " +
        "Restore: { creationMode: 'Restore', sourceDatabaseReference: { referenceType: 'ById', itemId, workspaceId }, restorePointInTime }. " +
        "RestoreDeletedDatabase: { creationMode: 'RestoreDeletedDatabase', restorableDeletedDatabaseName, restorePointInTime } (from sql_database_list_restorable_deleted_databases)."
      ),
    },
    WRITE,
    async ({ workspaceId, displayName, description, folderId, creationPayload }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        if (folderId) body.folderId = folderId;
        if (creationPayload) body.creationPayload = creationPayload;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/sqlDatabases`, body);
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
    "sql_database_update",
    "Update a SQL database's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      sqlDatabaseId: z.string().describe("The SQL database ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    WRITE,
    async ({ workspaceId, sqlDatabaseId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/sqlDatabases/${sqlDatabaseId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "sql_database_delete",
    "Delete a SQL database",
    {
      workspaceId: z.string().describe("The workspace ID"),
      sqlDatabaseId: z.string().describe("The SQL database ID"),
    },
    DESTRUCTIVE,
    async ({ workspaceId, sqlDatabaseId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/sqlDatabases/${sqlDatabaseId}`);
        return { content: [{ type: "text", text: `SQL database ${sqlDatabaseId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "sql_database_get_definition",
    "Get the public definition (dacpac or sqlproj) of a SQL database (long-running). Writes definition files to the specified output directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      sqlDatabaseId: z.string().describe("The SQL database ID"),
      outputDirectoryPath: z.string().describe("Directory path where definition files will be written"),
    },
    READ,
    async ({ workspaceId, sqlDatabaseId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/sqlDatabases/${sqlDatabaseId}/getDefinition`
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
        return { content: [{ type: "text", text: `SQL database definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "sql_database_update_definition",
    "Update a SQL database's public definition (long-running). Accepts definition parts (.dacpac, or .sqlproj/.sql files) inline or from a directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      sqlDatabaseId: z.string().describe("The SQL database ID"),
      format: z.enum(["dacpac", "sqlproj"]).optional().describe("Definition format (default: dacpac)"),
      parts: z.array(z.object({
        path: z.string().describe("The definition part path"),
        content: z.string().describe("The file content as a string"),
      })).optional().describe("Array of definition parts to upload"),
      partsDirectoryPath: z.string().optional().describe("Path to a directory containing definition files"),
    },
    WRITE,
    async ({ workspaceId, sqlDatabaseId, format, parts, partsDirectoryPath }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const resolved: FileEntry[] = await resolveFilesOrDirectory(parts, partsDirectoryPath);
        const body: Record<string, unknown> = {
          definition: {
            parts: resolved.map((part) => ({
              path: part.path,
              payload: encodeBase64(part.content),
              payloadType: "InlineBase64",
            })),
          },
        };
        if (format) (body.definition as Record<string, unknown>).format = format;
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/sqlDatabases/${sqlDatabaseId}/updateDefinition`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "SQL database definition updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "sql_database_list_restorable_deleted_databases",
    "List deleted SQL databases in a workspace that can still be restored via point-in-time recovery (preview)",
    { workspaceId: z.string().describe("The workspace ID") },
    READ,
    async ({ workspaceId }) => {
      try {
        const items = await paginateAll(fabricClient, `/workspaces/${workspaceId}/sqlDatabases/restorableDeletedDatabases`);
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "sql_database_start_mirroring",
    "Start mirroring for a SQL database (streams changes into OneLake in Delta format)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      sqlDatabaseId: z.string().describe("The SQL database ID"),
    },
    WRITE,
    async ({ workspaceId, sqlDatabaseId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.post(`/workspaces/${workspaceId}/sqlDatabases/${sqlDatabaseId}/startMirroring`);
        return { content: [{ type: "text", text: "Mirroring started successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "sql_database_stop_mirroring",
    "Stop mirroring for a SQL database",
    {
      workspaceId: z.string().describe("The workspace ID"),
      sqlDatabaseId: z.string().describe("The SQL database ID"),
    },
    WRITE,
    async ({ workspaceId, sqlDatabaseId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.post(`/workspaces/${workspaceId}/sqlDatabases/${sqlDatabaseId}/stopMirroring`);
        return { content: [{ type: "text", text: "Mirroring stopped successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
