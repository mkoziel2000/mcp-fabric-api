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
import { registerSqlEndpointTools } from "./tools/sql-endpoint.js";
import { registerAuthTools } from "./tools/auth.js";

export interface CreateServerOptions {
  tokenManager?: TokenManager;
}

export function createServer(options?: CreateServerOptions): McpServer {
  const server = new McpServer({
    name: "mcp-fabric-api",
    version: "1.0.0",
  });

  const tokenManager = options?.tokenManager ?? new TokenManager();
  const fabricClient = new FabricClient(tokenManager);
  const powerBIClient = new PowerBIClient(tokenManager);

  // Register all domain tools
  registerWorkspaceTools(server, fabricClient);
  registerLakehouseTools(server, fabricClient);
  registerNotebookTools(server, fabricClient);
  registerPipelineTools(server, fabricClient);
  registerSemanticModelTools(server, fabricClient, powerBIClient);
  registerReportTools(server, fabricClient, powerBIClient);
  registerDataflowTools(server, fabricClient);
  registerEventhouseTools(server, fabricClient);
  registerEventstreamTools(server, fabricClient);
  registerReflexTools(server, fabricClient);
  registerGraphQLApiTools(server, fabricClient, powerBIClient);
  registerSqlEndpointTools(server, fabricClient);
  registerAuthTools(server, tokenManager);

  return server;
}
