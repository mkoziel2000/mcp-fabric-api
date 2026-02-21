import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TokenManager } from "./auth/token-manager.js";
import { FabricClient } from "./client/fabric-client.js";
import { PowerBIClient } from "./client/powerbi-client.js";
import { registerWorkspaceTools } from "./tools/workspace.js";
import { registerLakehouseTools } from "./tools/lakehouse.js";
import { registerNotebookTools } from "./tools/notebook.js";
import { registerPipelineTools } from "./tools/pipeline.js";
import { registerSemanticModelTools } from "./tools/semantic-model.js";
import { registerReportTools } from "./tools/report.js";
import { registerDataflowTools } from "./tools/dataflow.js";
import { registerEventhouseTools } from "./tools/eventhouse.js";
import { registerEventstreamTools } from "./tools/eventstream.js";
import { registerReflexTools } from "./tools/reflex.js";
import { registerGraphQLApiTools } from "./tools/graphql-api.js";
import { registerWarehouseTools } from "./tools/warehouse.js";
import { registerSqlEndpointTools } from "./tools/sql-endpoint.js";
import { registerVariableLibraryTools } from "./tools/variable-library.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerGitIntegrationTools } from "./tools/git-integration.js";
import { registerDeploymentPipelineTools } from "./tools/deployment-pipeline.js";
import { registerMirroredDatabaseTools } from "./tools/mirrored-database.js";
import { registerKqlDatabaseTools } from "./tools/kql-database.js";
import { registerMlModelTools } from "./tools/ml-model.js";
import { registerMlExperimentTools } from "./tools/ml-experiment.js";
import { registerCopyJobTools } from "./tools/copy-job.js";
import { registerExternalDataShareTools } from "./tools/external-data-share.js";
import { SqlClient } from "./client/sql-client.js";
import { KustoClient } from "./client/kusto-client.js";
import { WorkspaceGuard } from "./core/workspace-guard.js";

export interface CreateServerOptions {
  tokenManager?: TokenManager;
}

export function createServer(options?: CreateServerOptions): McpServer {
  const server = new McpServer({
    name: "mcp-fabric-api",
    version: "2.1.1",
  });

  const tokenManager = options?.tokenManager ?? new TokenManager();
  const fabricClient = new FabricClient(tokenManager);
  const powerBIClient = new PowerBIClient(tokenManager);
  const sqlClient = new SqlClient(tokenManager);
  const kustoClient = new KustoClient(tokenManager);
  const workspaceGuard = new WorkspaceGuard();

  // Register all domain tools
  registerWorkspaceTools(server, fabricClient, workspaceGuard);
  registerLakehouseTools(server, fabricClient, sqlClient, workspaceGuard);
  registerWarehouseTools(server, fabricClient, workspaceGuard);
  registerNotebookTools(server, fabricClient, workspaceGuard);
  registerPipelineTools(server, fabricClient, workspaceGuard);
  registerSemanticModelTools(server, fabricClient, powerBIClient, workspaceGuard);
  registerReportTools(server, fabricClient, powerBIClient, workspaceGuard);
  registerDataflowTools(server, fabricClient, workspaceGuard);
  registerEventhouseTools(server, fabricClient, kustoClient, workspaceGuard);
  registerEventstreamTools(server, fabricClient, workspaceGuard);
  registerReflexTools(server, fabricClient, workspaceGuard);
  registerGraphQLApiTools(server, fabricClient, powerBIClient, workspaceGuard);
  registerSqlEndpointTools(server, fabricClient, sqlClient);
  registerVariableLibraryTools(server, fabricClient, workspaceGuard);
  registerGitIntegrationTools(server, fabricClient, workspaceGuard);
  registerDeploymentPipelineTools(server, fabricClient, workspaceGuard);
  registerMirroredDatabaseTools(server, fabricClient, workspaceGuard);
  registerKqlDatabaseTools(server, fabricClient, workspaceGuard);
  registerMlModelTools(server, fabricClient, workspaceGuard);
  registerMlExperimentTools(server, fabricClient, workspaceGuard);
  registerCopyJobTools(server, fabricClient, workspaceGuard);
  registerExternalDataShareTools(server, fabricClient, workspaceGuard);
  registerAuthTools(server, tokenManager);

  return server;
}
