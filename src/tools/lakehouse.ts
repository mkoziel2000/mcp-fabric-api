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

export function registerLakehouseTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "lakehouse_list",
    "List all lakehouses in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const lakehouses = await paginateAll(fabricClient, `/workspaces/${workspaceId}/lakehouses`);
        return { content: [{ type: "text", text: JSON.stringify(lakehouses, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_get",
    "Get details of a specific lakehouse including SQL endpoint and OneLake paths",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
    },
    async ({ workspaceId, lakehouseId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/lakehouses/${lakehouseId}`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_create",
    "Create a new lakehouse in a workspace (long-running operation). Schemas are enabled by default (preview).",
    {
      workspaceId: z.string().describe("The workspace ID"),
      displayName: z.string().describe("Display name for the lakehouse"),
      description: z.string().optional().describe("Description of the lakehouse"),
      enableSchemas: z.boolean().default(true).describe("Create a schema-enabled lakehouse (preview). Defaults to true. Set to false for a classic lakehouse without schema support."),
    },
    async ({ workspaceId, displayName, description, enableSchemas }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { displayName };
        if (description) body.description = description;
        if (enableSchemas) body.creationPayload = { enableSchemas: true };
        const response = await fabricClient.post(`/workspaces/${workspaceId}/lakehouses`, body);
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify({ operation: state, item: response.data }, null, 2) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_update",
    "Update a lakehouse's name or description",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      displayName: z.string().optional().describe("New display name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ workspaceId, lakehouseId, displayName, description }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/lakehouses/${lakehouseId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_delete",
    "Delete a lakehouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
    },
    async ({ workspaceId, lakehouseId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(`/workspaces/${workspaceId}/lakehouses/${lakehouseId}`);
        return { content: [{ type: "text", text: `Lakehouse ${lakehouseId} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_list_tables",
    "List all tables in a lakehouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
    },
    async ({ workspaceId, lakehouseId }) => {
      try {
        const tables = await paginateAll(fabricClient, `/workspaces/${workspaceId}/lakehouses/${lakehouseId}/tables`, "data");
        return { content: [{ type: "text", text: JSON.stringify(tables, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_load_table",
    "Load data into a lakehouse table from a file path (long-running operation)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      tableName: z.string().describe("Target table name"),
      relativePath: z.string().describe("Relative path to the source file in OneLake"),
      pathType: z.enum(["File", "Folder"]).describe("Type of the source path"),
      mode: z.enum(["Overwrite", "Append"]).optional().describe("Load mode (default: Overwrite)"),
      formatOptions: z.object({
        format: z.enum(["Csv", "Parquet", "Json"]).describe("File format"),
        header: z.boolean().optional().describe("Whether CSV has a header row"),
        delimiter: z.string().optional().describe("CSV delimiter character"),
      }).optional().describe("Format options for the source file"),
    },
    async ({ workspaceId, lakehouseId, tableName, relativePath, pathType, mode, formatOptions }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { relativePath, pathType };
        if (mode) body.mode = mode;
        if (formatOptions) body.formatOptions = formatOptions;
        const response = await fabricClient.post(
          `/workspaces/${workspaceId}/lakehouses/${lakehouseId}/tables/${tableName}/load`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "Table load initiated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_create_shortcut",
    "Create a OneLake shortcut in a lakehouse at any level (file, folder, table, or schema). " +
    "For schema-enabled lakehouses (preview): set path='Tables' and name to the desired schema name to create a schema shortcut that imports all Delta tables from the target as a new schema. " +
    "For table-level shortcuts within a schema: set path='Tables/<schemaName>'. " +
    "Supports targets: OneLake, ADLS Gen2, Amazon S3, Google Cloud Storage, S3 Compatible, Dataverse, Azure Blob Storage, OneDrive/SharePoint.",
    {
      workspaceId: z.string().describe("The workspace ID where the lakehouse resides"),
      lakehouseId: z.string().describe("The lakehouse ID (item ID) where the shortcut will be created"),
      name: z.string().describe("Name of the shortcut. For schema shortcuts, this becomes the schema name."),
      path: z.string().describe(
        "Full path where the shortcut is created. Must start with 'Files' or 'Tables'. " +
        "Examples: 'Files' (file at root), 'Files/landingZone' (file in subfolder), " +
        "'Tables' (schema shortcut — name becomes the schema, target should be a schema or folder of Delta tables), " +
        "'Tables/dbo' (table shortcut within the dbo schema), " +
        "'Tables/mySchema' (table shortcut within a custom schema)"
      ),
      shortcutConflictPolicy: z.enum(["Abort", "GenerateUniqueName", "CreateOrOverwrite", "OverwriteOnly"]).optional()
        .describe("Action when a shortcut with the same name and path already exists (default: Abort)"),
      target: z.object({
        oneLake: z.object({
          workspaceId: z.string().describe("Target workspace ID"),
          itemId: z.string().describe("Target item ID (Lakehouse, KQLDatabase, or Warehouse)"),
          path: z.string().describe("Full path to target folder relative to item root, e.g. 'Tables/myTable' or 'Files/myFolder'"),
          connectionId: z.string().optional().describe("Optional connection ID for cross-tenant shortcuts"),
        }).optional().describe("Target a OneLake location"),
        adlsGen2: z.object({
          location: z.string().describe("ADLS account URL, e.g. https://account.dfs.core.windows.net"),
          subpath: z.string().describe("Container and subfolder, e.g. /mycontainer/mysubfolder"),
          connectionId: z.string().describe("Cloud connection ID (GUID)"),
        }).optional().describe("Target an Azure Data Lake Storage Gen2 location"),
        amazonS3: z.object({
          location: z.string().describe("S3 bucket URL, e.g. https://bucket.s3.us-west-2.amazonaws.com"),
          subpath: z.string().describe("Target folder within the S3 bucket"),
          connectionId: z.string().describe("Cloud connection ID (GUID)"),
        }).optional().describe("Target an Amazon S3 location"),
        googleCloudStorage: z.object({
          location: z.string().describe("GCS bucket URL, e.g. https://bucket.storage.googleapis.com"),
          subpath: z.string().describe("Target folder within the GCS bucket"),
          connectionId: z.string().describe("Cloud connection ID (GUID)"),
        }).optional().describe("Target a Google Cloud Storage location"),
        s3Compatible: z.object({
          location: z.string().describe("S3 compatible endpoint URL, e.g. https://s3endpoint.contoso.com"),
          bucket: z.string().describe("Target bucket name"),
          subpath: z.string().describe("Target folder within the bucket"),
          connectionId: z.string().describe("Cloud connection ID (GUID)"),
        }).optional().describe("Target an S3 compatible storage location"),
        dataverse: z.object({
          environmentDomain: z.string().describe("Dataverse environment URL, e.g. https://org.crm.dynamics.com"),
          tableName: z.string().describe("Target Dataverse table name"),
          deltaLakeFolder: z.string().describe("DeltaLake folder path where target data is stored"),
          connectionId: z.string().describe("Cloud connection ID (GUID)"),
        }).optional().describe("Target a Dataverse location"),
        azureBlobStorage: z.object({
          location: z.string().describe("Azure Blob Storage URL, e.g. https://account.blob.core.windows.net"),
          subpath: z.string().describe("Container and subfolder, e.g. /mycontainer/mysubfolder"),
          connectionId: z.string().describe("Cloud connection ID (GUID)"),
        }).optional().describe("Target an Azure Blob Storage location"),
        oneDriveSharePoint: z.object({
          location: z.string().describe("SharePoint URL, e.g. https://contoso.sharepoint.com"),
          subpath: z.string().describe("Document library path, e.g. /Shared Documents/folder"),
          connectionId: z.string().describe("Cloud connection ID (GUID)"),
        }).optional().describe("Target a OneDrive for Business or SharePoint Online location"),
      }).describe("Target datasource — specify exactly one: oneLake, adlsGen2, amazonS3, googleCloudStorage, s3Compatible, dataverse, azureBlobStorage, or oneDriveSharePoint"),
    },
    async ({ workspaceId, lakehouseId, name, path, shortcutConflictPolicy, target }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);

        const targetKeys = Object.keys(target).filter(
          (k) => target[k as keyof typeof target] !== undefined
        );
        if (targetKeys.length !== 1) {
          return {
            content: [{ type: "text" as const, text: "Error: Specify exactly one target type (oneLake, adlsGen2, amazonS3, googleCloudStorage, s3Compatible, dataverse, azureBlobStorage, or oneDriveSharePoint)" }],
            isError: true,
          };
        }

        const body = { name, path, target };
        let url = `/workspaces/${workspaceId}/items/${lakehouseId}/shortcuts`;
        if (shortcutConflictPolicy) {
          url += `?shortcutConflictPolicy=${shortcutConflictPolicy}`;
        }

        const response = await fabricClient.post(url, body);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_get_sql_endpoint",
    "Get the SQL endpoint details for a lakehouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
    },
    async ({ workspaceId, lakehouseId }) => {
      try {
        const response = await fabricClient.get<Record<string, unknown>>(`/workspaces/${workspaceId}/lakehouses/${lakehouseId}`);
        const properties = response.data.properties as Record<string, unknown> | undefined;
        const sqlEndpoint = properties?.sqlEndpointProperties;
        if (!sqlEndpoint) {
          return { content: [{ type: "text", text: "No SQL endpoint available for this lakehouse" }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(sqlEndpoint, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_get_definition",
    "Get the definition of a lakehouse (long-running). Writes definition files to the specified output directory.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      outputDirectoryPath: z.string().describe("Directory path where definition files will be written"),
    },
    async ({ workspaceId, lakehouseId, outputDirectoryPath }) => {
      try {
        const response = await fabricClient.post<Record<string, unknown>>(
          `/workspaces/${workspaceId}/lakehouses/${lakehouseId}/getDefinition`
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
        return { content: [{ type: "text", text: `Lakehouse definition written to: ${outputDirectoryPath}\nFiles:\n${written.map((f) => `  ${f}`).join("\n")}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_update_definition",
    "Update a lakehouse's definition (long-running). Accepts definition parts inline or a directory path.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      parts: z.array(z.object({
        path: z.string().describe("The definition part path"),
        content: z.string().describe("The file content as a string"),
      })).optional().describe("Array of definition parts to upload"),
      partsDirectoryPath: z.string().optional().describe("Path to a directory containing definition files"),
    },
    async ({ workspaceId, lakehouseId, parts, partsDirectoryPath }) => {
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
          `/workspaces/${workspaceId}/lakehouses/${lakehouseId}/updateDefinition`,
          body
        );
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: "Lakehouse definition updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_list_shortcuts",
    "List all OneLake shortcuts in a lakehouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
    },
    async ({ workspaceId, lakehouseId }) => {
      try {
        const shortcuts = await paginateAll(fabricClient, `/workspaces/${workspaceId}/items/${lakehouseId}/shortcuts`);
        return { content: [{ type: "text", text: JSON.stringify(shortcuts, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_get_shortcut",
    "Get details of a specific OneLake shortcut in a lakehouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      shortcutPath: z.string().describe("The shortcut path (e.g., 'Tables' or 'Files/landingZone')"),
      shortcutName: z.string().describe("The shortcut name"),
    },
    async ({ workspaceId, lakehouseId, shortcutPath, shortcutName }) => {
      try {
        const response = await fabricClient.get(
          `/workspaces/${workspaceId}/items/${lakehouseId}/shortcuts/${shortcutPath}/${shortcutName}`
        );
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_delete_shortcut",
    "Delete a OneLake shortcut from a lakehouse",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      shortcutPath: z.string().describe("The shortcut path (e.g., 'Tables' or 'Files/landingZone')"),
      shortcutName: z.string().describe("The shortcut name"),
    },
    async ({ workspaceId, lakehouseId, shortcutPath, shortcutName }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.delete(
          `/workspaces/${workspaceId}/items/${lakehouseId}/shortcuts/${shortcutPath}/${shortcutName}`
        );
        return { content: [{ type: "text", text: `Shortcut ${shortcutName} at ${shortcutPath} deleted successfully` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
