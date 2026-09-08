import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { OneLakeClient } from "../client/onelake-client.js";
import { formatToolError } from "../core/errors.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";
import { readBinaryFile, writeBinaryFile } from "../utils/file-utils.js";

const READ = { readOnlyHint: true, destructiveHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

/** Files-section paths are rooted under "Files" in a lakehouse; strip any leading/trailing slashes the caller supplies. */
function filesPath(path?: string): string {
  const trimmed = (path ?? "").replace(/^\/+|\/+$/g, "");
  return trimmed ? `Files/${trimmed}` : "Files";
}

export function registerLakehouseFileTools(
  server: McpServer,
  fabricClient: FabricClient,
  oneLakeClient: OneLakeClient,
  workspaceGuard: WorkspaceGuard
) {
  server.tool(
    "lakehouse_list_files",
    "List files and folders under a path in a lakehouse's Files section (OneLake Data Access API)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      path: z.string().optional().describe("Relative folder path under Files (omit for the Files root)"),
      recursive: z.boolean().default(false).describe("List all nested files/folders recursively"),
    },
    READ,
    async ({ workspaceId, lakehouseId, path, recursive }) => {
      try {
        const items = await oneLakeClient.listPaths(workspaceId, lakehouseId, filesPath(path), recursive);
        return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_get_file_properties",
    "Get metadata (size, last modified, etag, resource type) for a file or folder in a lakehouse's Files section",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      path: z.string().describe("Relative path under Files to the file or folder"),
    },
    READ,
    async ({ workspaceId, lakehouseId, path }) => {
      try {
        const properties = await oneLakeClient.getProperties(workspaceId, lakehouseId, filesPath(path));
        return { content: [{ type: "text", text: JSON.stringify(properties, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_create_folder",
    "Create a folder in a lakehouse's Files section",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      path: z.string().describe("Relative folder path under Files to create, e.g. 'landingZone/2026'"),
    },
    WRITE,
    async ({ workspaceId, lakehouseId, path }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await oneLakeClient.createDirectory(workspaceId, lakehouseId, filesPath(path));
        return { content: [{ type: "text", text: `Folder created at Files/${path}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_upload_file",
    "Upload a local file to a lakehouse's Files section",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      localFilePath: z.string().describe("Path to the local file to upload"),
      destinationPath: z.string().describe("Relative destination path under Files, including filename, e.g. 'landingZone/data.csv'"),
      overwrite: z.boolean().default(false).describe("Overwrite the file if it already exists (default: false)"),
    },
    WRITE,
    async ({ workspaceId, lakehouseId, localFilePath, destinationPath, overwrite }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const content = await readBinaryFile(localFilePath);
        await oneLakeClient.uploadFile(workspaceId, lakehouseId, filesPath(destinationPath), content, overwrite);
        return { content: [{ type: "text", text: `Uploaded ${content.byteLength} bytes to Files/${destinationPath}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_download_file",
    "Download a file from a lakehouse's Files section to local disk",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      sourcePath: z.string().describe("Relative source path under Files, including filename, e.g. 'landingZone/data.csv'"),
      localFilePath: z.string().describe("Local file path to write the downloaded content to"),
    },
    READ,
    async ({ workspaceId, lakehouseId, sourcePath, localFilePath }) => {
      try {
        const content = await oneLakeClient.downloadFile(workspaceId, lakehouseId, filesPath(sourcePath));
        const written = await writeBinaryFile(localFilePath, content);
        return { content: [{ type: "text", text: `Downloaded ${content.byteLength} bytes to ${written}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_move_file",
    "Move or rename a file or folder within a lakehouse's Files section",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      sourcePath: z.string().describe("Relative source path under Files"),
      destinationPath: z.string().describe("Relative destination path under Files"),
    },
    WRITE,
    async ({ workspaceId, lakehouseId, sourcePath, destinationPath }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await oneLakeClient.movePath(workspaceId, lakehouseId, filesPath(sourcePath), filesPath(destinationPath));
        return { content: [{ type: "text", text: `Moved Files/${sourcePath} to Files/${destinationPath}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "lakehouse_delete_file",
    "Delete a file or folder from a lakehouse's Files section",
    {
      workspaceId: z.string().describe("The workspace ID"),
      lakehouseId: z.string().describe("The lakehouse ID"),
      path: z.string().describe("Relative path under Files to the file or folder to delete"),
      recursive: z.boolean().default(false).describe("Required to delete a non-empty folder"),
    },
    DESTRUCTIVE,
    async ({ workspaceId, lakehouseId, path, recursive }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await oneLakeClient.deletePath(workspaceId, lakehouseId, filesPath(path), recursive);
        return { content: [{ type: "text", text: `Deleted Files/${path}` }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
