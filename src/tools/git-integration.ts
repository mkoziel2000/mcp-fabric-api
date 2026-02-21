import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FabricClient } from "../client/fabric-client.js";
import { formatToolError } from "../core/errors.js";
import { pollOperation } from "../core/lro.js";
import { WorkspaceGuard } from "../core/workspace-guard.js";

export function registerGitIntegrationTools(server: McpServer, fabricClient: FabricClient, workspaceGuard: WorkspaceGuard) {
  server.tool(
    "git_get_connection",
    "Get the Git connection details for a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/git/connection`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "git_get_status",
    "Get the Git status of items in a workspace (shows sync state between workspace and remote)",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/git/status`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "git_connect",
    "Connect a workspace to a Git repository (Azure DevOps or GitHub)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      gitProviderDetails: z.object({
        gitProviderType: z.enum(["AzureDevOps", "GitHub"]).describe("Git provider type"),
        organizationName: z.string().describe("Organization or account name"),
        projectName: z.string().optional().describe("Project name (required for Azure DevOps)"),
        repositoryName: z.string().describe("Repository name"),
        branchName: z.string().describe("Branch name to connect to"),
        directoryName: z.string().optional().describe("Directory path within the repository"),
      }).describe("Git provider connection details"),
    },
    async ({ workspaceId, gitProviderDetails }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const response = await fabricClient.post(`/workspaces/${workspaceId}/git/connect`, { gitProviderDetails });
        return { content: [{ type: "text", text: response.data ? JSON.stringify(response.data, null, 2) : "Git connection established successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "git_disconnect",
    "Disconnect a workspace from its Git repository",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        await fabricClient.post(`/workspaces/${workspaceId}/git/disconnect`);
        return { content: [{ type: "text", text: "Git connection disconnected successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "git_initialize_connection",
    "Initialize a Git connection after connecting (long-running). Chooses whether workspace or remote content takes precedence.",
    {
      workspaceId: z.string().describe("The workspace ID"),
      initializationStrategy: z.enum(["PreferWorkspace", "PreferRemote"]).describe("Strategy for resolving conflicts during initialization"),
    },
    async ({ workspaceId, initializationStrategy }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const response = await fabricClient.post(`/workspaces/${workspaceId}/git/initializeConnection`, { initializationStrategy });
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: response.data ? JSON.stringify(response.data, null, 2) : "Git connection initialized successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "git_commit_to_git",
    "Commit workspace changes to the connected Git repository (long-running)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      mode: z.enum(["All", "Selective"]).describe("Commit mode: All items or Selective"),
      comment: z.string().optional().describe("Commit comment/message"),
      items: z.array(z.object({
        objectId: z.string().describe("The item object ID"),
        logicalId: z.string().optional().describe("The item logical ID"),
      })).optional().describe("Items to commit (required when mode is Selective)"),
      workspaceHead: z.string().optional().describe("Workspace head object ID for concurrency control"),
    },
    async ({ workspaceId, mode, comment, items, workspaceHead }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { mode };
        if (comment) body.comment = comment;
        if (items) body.items = items;
        if (workspaceHead) body.workspaceHead = workspaceHead;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/git/commitToGit`, body);
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: response.data ? JSON.stringify(response.data, null, 2) : "Changes committed to Git successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "git_update_from_git",
    "Update workspace from the connected Git repository (long-running)",
    {
      workspaceId: z.string().describe("The workspace ID"),
      remoteCommitHash: z.string().describe("The remote commit hash to update to"),
      conflictResolution: z.object({
        conflictResolutionType: z.enum(["Workspace", "Remote"]).describe("How to resolve conflicts"),
        conflictResolutionPolicy: z.enum(["PreferWorkspace", "PreferRemote"]).optional().describe("Conflict resolution policy"),
      }).optional().describe("Conflict resolution settings"),
      workspaceHead: z.string().optional().describe("Workspace head object ID for concurrency control"),
      options: z.object({
        allowOverrideItems: z.boolean().optional().describe("Allow overriding workspace items"),
      }).optional().describe("Update options"),
    },
    async ({ workspaceId, remoteCommitHash, conflictResolution, workspaceHead, options }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { remoteCommitHash };
        if (conflictResolution) body.conflictResolution = conflictResolution;
        if (workspaceHead) body.workspaceHead = workspaceHead;
        if (options) body.options = options;
        const response = await fabricClient.post(`/workspaces/${workspaceId}/git/updateFromGit`, body);
        if (response.lro) {
          const state = await pollOperation(fabricClient, response.lro.operationId);
          return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
        }
        return { content: [{ type: "text", text: response.data ? JSON.stringify(response.data, null, 2) : "Workspace updated from Git successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "git_get_credentials",
    "Get the Git credentials configuration for the current user in a workspace",
    { workspaceId: z.string().describe("The workspace ID") },
    async ({ workspaceId }) => {
      try {
        const response = await fabricClient.get(`/workspaces/${workspaceId}/git/myGitCredentials`);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "git_update_credentials",
    "Update the Git credentials configuration for the current user in a workspace",
    {
      workspaceId: z.string().describe("The workspace ID"),
      source: z.enum(["Automatic", "None", "ConfiguredConnection"]).describe("Credential source type"),
      connectionId: z.string().optional().describe("Connection ID (required when source is ConfiguredConnection)"),
    },
    async ({ workspaceId, source, connectionId }) => {
      try {
        await workspaceGuard.assertWorkspaceAllowed(fabricClient, workspaceId);
        const body: Record<string, unknown> = { source };
        if (connectionId) body.connectionId = connectionId;
        const response = await fabricClient.patch(`/workspaces/${workspaceId}/git/myGitCredentials`, body);
        return { content: [{ type: "text", text: response.data ? JSON.stringify(response.data, null, 2) : "Git credentials updated successfully" }] };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
