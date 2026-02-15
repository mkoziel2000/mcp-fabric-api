# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

mcp-fabric-api is an MCP (Model Context Protocol) server for the Microsoft Fabric REST APIs. It wraps ~93 tools across 12 domains (workspaces, lakehouses, notebooks, pipelines, semantic models, reports, dataflows, eventhouses, eventstreams, reflexes, GraphQL APIs, SQL endpoints) to enable AI assistants to manage Fabric resources.

## Architecture

```
src/
  index.ts                    # Entry point: selects stdio or HTTP transport
  server.ts                   # McpServer factory + tool registration
  auth/
    token-manager.ts          # DefaultAzureCredential wrapper, dual-scope token caching
    oauth-handler.ts          # OAuth2 metadata + token validation middleware (HTTP mode)
  client/
    fabric-client.ts          # HTTP client for https://api.fabric.microsoft.com/v1/
    powerbi-client.ts         # HTTP client for https://api.powerbi.com/v1.0/myorg/
  core/
    errors.ts                 # FabricApiError + formatToolError helper
    types.ts                  # Shared TypeScript interfaces
    pagination.ts             # continuationToken/continuationUri pagination
    lro.ts                    # Long-running operation polling (202 → /operations/{id})
    job-scheduler.ts          # On-demand job run/cancel/status/list
  tools/
    workspace.ts              # 6 tools
    lakehouse.ts              # 8 tools
    notebook.ts               # 10 tools
    pipeline.ts               # 13 tools
    semantic-model.ts         # 11 tools
    report.ts                 # 10 tools
    dataflow.ts               # 7 tools
    eventhouse.ts             # 5 tools
    eventstream.ts            # 7 tools
    reflex.ts                 # 6 tools
    graphql-api.ts            # 7 tools
    sql-endpoint.ts           # 3 tools
  utils/
    base64.ts                 # Base64 encode/decode for item definitions
    tmdl.ts                   # TMDL encode/decode/format helpers for semantic models
```

## Build & Run

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript (tsc)
npm start            # Run the server (stdio mode by default)
npm run dev          # Watch mode (tsc --watch)
npm run inspect      # Launch MCP Inspector
```

## Key Patterns

- **Tool naming:** `domain_action` (e.g., `lakehouse_list_tables`, `semantic_model_execute_dax`)
- **Tool registration:** Each domain module exports `register<Domain>Tools(server, fabricClient, powerBiClient?)`
- **Error handling:** Tools catch errors and return `{ content, isError: true }` via `formatToolError()`, never throw `McpError`
- **LRO:** Detect 202 responses → poll `/v1/operations/{operationId}` until terminal state
- **Pagination:** Follow `continuationUri` or `continuationToken` in response body
- **Dual tokens:** Fabric scope (`https://api.fabric.microsoft.com/.default`) and Power BI scope (`https://analysis.windows.net/powerbi/api/.default`)
- **Transport:** `TRANSPORT=stdio` (default) or `TRANSPORT=http` (Express + StreamableHTTP)
- **Logging:** `console.error()` only — stdout is reserved for JSON-RPC in stdio mode
- **ESM:** Project uses `"type": "module"`, all imports use `.js` extensions

## Adding a New Domain

1. Create `src/tools/<domain>.ts` with `register<Domain>Tools(server, fabricClient, ...)`
2. Import and call the register function in `src/server.ts`
3. Rebuild with `npm run build`

## API Base URLs

- Fabric: `https://api.fabric.microsoft.com/v1/`
- Power BI: `https://api.powerbi.com/v1.0/myorg/`
