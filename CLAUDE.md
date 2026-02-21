# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

mcp-fabric-api is an MCP (Model Context Protocol) server for the Microsoft Fabric REST APIs. It wraps 116 tools across 15 domains (workspaces, lakehouses, warehouses, notebooks, pipelines, semantic models, reports, dataflows, eventhouses, eventstreams, reflexes, GraphQL APIs, SQL endpoints, variable libraries, auth) to enable AI assistants to manage Fabric resources.

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
    auth.ts                   # 4 tools
    workspace.ts              # 6 tools
    lakehouse.ts              # 9 tools
    warehouse.ts              # 7 tools
    notebook.ts               # 10 tools
    pipeline.ts               # 13 tools
    semantic-model.ts         # 12 tools
    report.ts                 # 10 tools
    dataflow.ts               # 7 tools
    eventhouse.ts             # 7 tools
    eventstream.ts            # 7 tools
    reflex.ts                 # 6 tools
    graphql-api.ts            # 7 tools
    sql-endpoint.ts           # 4 tools
    variable-library.ts       # 7 tools
  utils/
    base64.ts                 # Base64 encode/decode for item definitions
    tmdl.ts                   # TMDL encode/decode/format helpers for semantic models
    file-utils.ts             # File read/write helpers for definition I/O
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

## File-Based I/O for Large Payloads

Fabric item definitions (BIM JSON, TMDL files, report definitions, eventstream configs, etc.) can be very large. Passing these payloads inline through MCP tool inputs/outputs will overwhelm the client LLM's context window and cause max output token errors. To avoid this, **all definition tools must use file paths instead of inline content**:

- **Sending definitions to Fabric (create/update):** Tool parameters accept a file path or directory path. The server reads the files from disk, base64-encodes them, and uploads to the Fabric API. Use `readContentFromFile()` for single files and `readFilesFromDirectory()` for multi-file definitions (see `src/utils/file-utils.ts`).
- **Retrieving definitions from Fabric (get):** The server downloads and decodes the definition, then writes it to disk at the path specified by the caller. The tool returns only the file path(s), not the content. Use `writeContentToFile()` for single files and `writeFilesToDirectory()` for multi-file definitions.

When adding new tools against Fabric APIs that deal with item definitions or other potentially large payloads, always follow this pattern. Never return large definition content inline in the tool response — write it to disk and return the path.

## API Base URLs

- Fabric: `https://api.fabric.microsoft.com/v1/`
- Power BI: `https://api.powerbi.com/v1.0/myorg/`
