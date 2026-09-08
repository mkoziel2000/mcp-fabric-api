# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

mcp-fabric-api is an MCP (Model Context Protocol) server for the Microsoft Fabric REST APIs. It wraps 120 tools across 15 domains (workspaces, lakehouses, warehouses, notebooks, pipelines, semantic models, reports, dataflows, eventhouses, eventstreams, reflexes, GraphQL APIs, SQL endpoints, variable libraries, auth) to enable AI assistants to manage Fabric resources.

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
    onelake-client.ts         # ADLS Gen2-compatible client for https://onelake.dfs.fabric.microsoft.com/ (lakehouse Files CRUD)
  core/
    errors.ts                 # FabricApiError + formatToolError helper
    types.ts                  # Shared TypeScript interfaces
    pagination.ts             # continuationToken/continuationUri pagination
    lro.ts                    # Long-running operation polling (202 → /operations/{id})
    job-scheduler.ts          # On-demand job run/cancel/status/list
  tools/
    auth.ts                   # 4 tools
    workspace.ts              # 11 tools (incl. role assignments)
    lakehouse.ts              # 14 tools
    lakehouse-files.ts        # 7 tools (Files section CRUD via OneLake Data Access API)
    warehouse.ts              # 7 tools
    notebook.ts               # 15 tools (incl. Livy session/log diagnostics)
    pipeline.ts               # 16 tools (incl. per-activity run query)
    semantic-model.ts         # 12 tools
    report.ts                 # 10 tools
    dataflow.ts               # 7 tools
    eventhouse.ts             # 7 tools
    eventstream.ts            # 7 tools
    reflex.ts                 # 6 tools
    graphql-api.ts            # 7 tools
    sql-endpoint.ts           # 4 tools
    sql-database.ts           # 10 tools (SQL Database item — Fabric's native OLTP database, distinct from Warehouse)
    variable-library.ts       # 7 tools
    folder.ts                 # 6 tools (in-workspace folder hierarchy, preview API)
    tag.ts                    # 3 tools (tenant tags + apply/unapply on items)
    catalog.ts                # 1 tool (cross-workspace item search, preview API)
    onelake-data-access.ts    # 4 tools (OneLake data access roles — table/folder-level read security, preview API)
    kql-queryset.ts           # 7 tools
    kql-dashboard.ts          # 7 tools
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
- **Multi-scope tokens:** Fabric (`https://api.fabric.microsoft.com/.default`), Power BI (`https://analysis.windows.net/powerbi/api/.default`), SQL (`https://database.windows.net/.default`), Kusto (`https://api.kusto.windows.net/.default`), and OneLake/ADLS (`https://storage.azure.com/.default`) — see `TokenManager`
- **OneLake Files access:** Lakehouse Files-section CRUD (`lakehouse_list_files`, `lakehouse_upload_file`, etc.) does not go through the Fabric REST API — it uses the OneLake Data Access API (`OneLakeClient`), an ADLS Gen2-compatible surface addressed as `/{workspaceId}/{itemId}/{path}` at `https://onelake.dfs.fabric.microsoft.com`. Uploads/downloads use binary-safe file I/O (`readBinaryFile`/`writeBinaryFile`), not the UTF-8 helpers used for definition JSON/TMDL.
- **Run diagnostics:** There is no API for structured notebook cell output or a "run snapshot" — `notebook_get_livy_log` (`type=driver`) is the closest thing, returning raw Spark driver stdout/stderr as text. Pipeline per-activity detail (status/input/output/error per activity, not just overall run status) comes from `pipeline_query_activity_runs`, which POSTs to `/workspaces/{workspaceId}/datapipelines/pipelineruns/{jobId}/queryactivityruns` — a real but lightly-documented endpoint (not in the formal `/rest/api/fabric/` reference catalog, only in the conceptual Data Factory REST API docs).
- **Preview APIs:** Folders, Catalog Search, and OneLake Data Access Security are Microsoft-labeled preview surfaces — paths/params may change upstream. The single-role OneLake Data Access Security operations (`onelake_get_data_access_role`, `onelake_set_data_access_role`, `onelake_list_data_access_roles`, `onelake_delete_data_access_role`) require `?preview=true` on the query string; the bulk "replace all roles" variant does not (and is intentionally not exposed as a tool — it wipes roles not present in the payload, so `onelake_set_data_access_role` upserts one role at a time instead).
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
- OneLake Data Access (ADLS Gen2-compatible): `https://onelake.dfs.fabric.microsoft.com/`
