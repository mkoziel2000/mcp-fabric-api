# mcp-fabric-api

MCP (Model Context Protocol) server for the Microsoft Fabric REST APIs. Built for data engineers and data analysts who want to use AI assistants beyond Copilot — such as Claude, Claude Code, or any MCP-compatible client — to build and manage their Fabric components. Covers workspaces, lakehouses, warehouses, notebooks, pipelines, semantic models, reports, dataflows, eventhouses, eventstreams, reflexes, GraphQL APIs, and SQL endpoints.

> **Safe by default:** This server blocks all destructive operations (create, update, delete) until you explicitly configure the `WRITABLE_WORKSPACES` environment variable. Read operations always work. Set `WRITABLE_WORKSPACES="*"` to allow writes to all workspaces, or use patterns to limit access. See [Workspace Safety Guard](#workspace-safety-guard) for details.

## Prerequisites

- Node.js 18+
- Azure CLI (`az login` for authentication)
- Access to a Microsoft Fabric workspace

## Quick Start

Authenticate with Azure CLI:

```bash
az login
```

Run directly with npx (no install needed):

```bash
npx @einlogic/mcp-fabric-api
```

## Setup

### Claude Desktop

Add to your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "fabric": {
      "command": "npx",
      "args": ["-y", "@einlogic/mcp-fabric-api"]
    }
  }
}
```

### Claude Code CLI

```bash
claude mcp add fabric -- npx -y @einlogic/mcp-fabric-api
```

To verify it was added:

```bash
claude mcp list
```

### HTTP Mode (Remote)

For remote deployments, set environment variables:

```bash
export TRANSPORT=http
export PORT=3000
export AZURE_CLIENT_ID=your-client-id
export AZURE_CLIENT_SECRET=your-client-secret
export AZURE_TENANT_ID=your-tenant-id
npx @einlogic/mcp-fabric-api
```

The server exposes:
- `POST /mcp` — MCP endpoint (StreamableHTTP)
- `GET /mcp` — SSE stream for server notifications
- `DELETE /mcp` — Session cleanup
- `GET /.well-known/oauth-protected-resource` — OAuth metadata

### Workspace Safety Guard

Control which workspaces allow write operations (create, update, delete) via the `WRITABLE_WORKSPACES` environment variable. Only workspaces matching the configured name patterns will permit CUD (Create, Update, Delete) operations. Read operations are never restricted.

> **Default behavior: When `WRITABLE_WORKSPACES` is not set or empty, all destructive operations are blocked.** You must explicitly configure this variable to enable writes.

| `WRITABLE_WORKSPACES` value | Behavior |
|------------------------------|----------|
| Not set / empty | **All writes blocked** (safe default) |
| `*` | All workspaces writable |
| `*-Dev,*-Test,Sandbox*` | Only matching workspaces writable |

Set comma-separated glob patterns:

```bash
WRITABLE_WORKSPACES=*-Dev,*-Test,Sandbox*
```

**Wildcard examples:**
- `*` matches all workspaces (allow everything)
- `*-Dev` matches "Sales-Dev", "Finance-Dev"
- `Sandbox*` matches "Sandbox-123", "Sandbox-Mike"
- `Exact-Name` matches only "Exact-Name" (case-insensitive)

**Guarded tools (47 total)** — every tool that creates, updates, or deletes workspace items:

| Domain | Guarded tools |
|--------|--------------|
| Workspace | `workspace_update`, `workspace_delete` |
| Lakehouse | `lakehouse_create`, `lakehouse_update`, `lakehouse_delete`, `lakehouse_load_table`, `lakehouse_create_shortcut` |
| Warehouse | `warehouse_create`, `warehouse_update`, `warehouse_delete` |
| Notebook | `notebook_create`, `notebook_update`, `notebook_delete`, `notebook_update_definition` |
| Pipeline | `pipeline_create`, `pipeline_update`, `pipeline_delete`, `pipeline_create_schedule`, `pipeline_update_schedule`, `pipeline_delete_schedule` |
| Semantic Model | `semantic_model_create`, `semantic_model_create_tmdl`, `semantic_model_update`, `semantic_model_delete`, `semantic_model_update_definition`, `semantic_model_update_tmdl` |
| Report | `report_create`, `report_update`, `report_delete`, `report_clone`, `report_update_definition` |
| Dataflow | `dataflow_create`, `dataflow_update`, `dataflow_delete` |
| Eventhouse | `eventhouse_create`, `eventhouse_update`, `eventhouse_delete` |
| Eventstream | `eventstream_create`, `eventstream_update`, `eventstream_delete`, `eventstream_update_definition` |
| Reflex | `reflex_create`, `reflex_update`, `reflex_delete` |
| GraphQL API | `graphql_api_create`, `graphql_api_update`, `graphql_api_delete` |

**Not guarded:** Read operations (list, get, get_definition, get_status), query execution (DAX, KQL, SQL, GraphQL), run/refresh/cancel operations, and export operations.

**Claude Desktop config with guard:**
```json
{
  "mcpServers": {
    "fabric": {
      "command": "npx",
      "args": ["-y", "@einlogic/mcp-fabric-api"],
      "env": {
        "WRITABLE_WORKSPACES": "*-Dev,*-Test,Sandbox*"
      }
    }
  }
}
```

**Claude Code CLI with guard:**
```bash
WRITABLE_WORKSPACES="*-Dev,*-Test" claude mcp add fabric -- npx -y @einlogic/mcp-fabric-api
```

**Error when not configured:**
```
WRITABLE_WORKSPACES is not configured. Destructive actions are blocked by default. Set WRITABLE_WORKSPACES to a comma-separated list of workspace name patterns, or "*" to allow all.
```

**Error when workspace not in allow list:**
```
Workspace "Production-Analytics" is not in the writable workspaces list. Allowed patterns: *-Dev, *-Test, Sandbox*
```

### File Path References

Some tools accept large payloads (notebook code, model.bim JSON, TMDL files, report definitions) that may exceed message size limits. Instead of passing content inline, you can write payloads to local files and pass file paths.

**Single-content tools** — use `contentFilePath` or `definitionFilePath` instead of inline content:

| Tool | File path parameter |
|------|-------------------|
| `notebook_update_definition` | `contentFilePath` |
| `semantic_model_create` | `definitionFilePath` |
| `semantic_model_update_definition` | `definitionFilePath` |
| `eventstream_update_definition` | `contentFilePath` |

**Multi-file tools** — use `filesDirectoryPath` or `partsDirectoryPath` instead of inline file arrays:

| Tool | Directory path parameter | Extension filter |
|------|------------------------|-----------------|
| `semantic_model_create_tmdl` | `filesDirectoryPath` | `.tmdl`, `.pbism` |
| `semantic_model_update_tmdl` | `filesDirectoryPath` | `.tmdl`, `.pbism` |
| `report_update_definition` | `partsDirectoryPath` | all files |

**Example — inline vs file path:**
```json
// Inline (may hit size limits)
{ "content": "# Notebook code\nprint('hello')" }

// File path reference
{ "contentFilePath": "/tmp/notebook-content.py" }
```

**TMDL directory structure example:**
```
/tmp/my-model/
  model.tmdl
  definition.pbism
  definition/
    tables/
      Sales.tmdl
      Product.tmdl
    relationships.tmdl
```

## Development

```bash
git clone https://github.com/your-org/mcp-fabric-api.git
cd mcp-fabric-api
npm install
npm run build
npm start
npm run dev          # Watch mode
npm run inspect      # Launch MCP Inspector
```

## Tools (98 total)

### Auth (4 tools)
| Tool | Description |
|------|-------------|
| `auth_get_current_account` | Show current Azure identity, tenant, and token expiry |
| `auth_list_available_accounts` | List subscriptions/tenants from local `az login` state (does not query Entra) |
| `auth_switch_tenant` | Switch to a different Azure tenant (with rollback on failure) |
| `auth_clear_token_cache` | Clear cached tokens to force re-acquisition |

### Workspace (6 tools)
| Tool | Description |
|------|-------------|
| `workspace_list` | List all accessible Fabric workspaces |
| `workspace_get` | Get details of a specific workspace |
| `workspace_create` | Create a new workspace |
| `workspace_update` | Update a workspace's name or description |
| `workspace_delete` | Delete a workspace |
| `workspace_list_items` | List all items in a workspace (with optional type filter) |

### Lakehouse (9 tools)
| Tool | Description |
|------|-------------|
| `lakehouse_list` | List all lakehouses in a workspace |
| `lakehouse_get` | Get lakehouse details (SQL endpoint, OneLake paths) |
| `lakehouse_create` | Create a new lakehouse (LRO, schemas enabled by default) |
| `lakehouse_update` | Update lakehouse name or description |
| `lakehouse_delete` | Delete a lakehouse |
| `lakehouse_list_tables` | List all tables in a lakehouse |
| `lakehouse_load_table` | Load data into a table from OneLake (LRO) |
| `lakehouse_create_shortcut` | Create a OneLake shortcut (file, folder, table, or schema level) with support for multiple target types |
| `lakehouse_get_sql_endpoint` | Get SQL endpoint details |

### Warehouse (7 tools)
| Tool | Description |
|------|-------------|
| `warehouse_list` | List all warehouses in a workspace |
| `warehouse_get` | Get warehouse details including connection string and provisioning status |
| `warehouse_create` | Create a new warehouse (LRO) |
| `warehouse_update` | Update warehouse name or description |
| `warehouse_delete` | Delete a warehouse |
| `warehouse_get_sql_endpoint` | Get SQL connection details for a warehouse |
| `warehouse_list_tables` | List all tables in a warehouse |

### Notebook (10 tools)
| Tool | Description |
|------|-------------|
| `notebook_list` | List all notebooks in a workspace |
| `notebook_get` | Get notebook details |
| `notebook_create` | Create a new notebook (LRO) |
| `notebook_update` | Update notebook name or description |
| `notebook_delete` | Delete a notebook |
| `notebook_get_definition` | Get notebook content (decoded from base64) |
| `notebook_update_definition` | Update notebook content (supports file path reference) |
| `notebook_run` | Run a notebook on demand |
| `notebook_get_run_status` | Get notebook run status |
| `notebook_cancel_run` | Cancel a running notebook |

### Pipeline (13 tools)
| Tool | Description |
|------|-------------|
| `pipeline_list` | List all data pipelines |
| `pipeline_get` | Get pipeline details |
| `pipeline_create` | Create a new pipeline |
| `pipeline_update` | Update pipeline name or description |
| `pipeline_delete` | Delete a pipeline |
| `pipeline_run` | Run a pipeline on demand |
| `pipeline_get_run_status` | Get pipeline run status |
| `pipeline_cancel_run` | Cancel a running pipeline |
| `pipeline_list_runs` | List all run instances |
| `pipeline_list_schedules` | List pipeline schedules |
| `pipeline_create_schedule` | Create a pipeline schedule |
| `pipeline_update_schedule` | Update a pipeline schedule |
| `pipeline_delete_schedule` | Delete a pipeline schedule |

### Semantic Model (12 tools)
| Tool | Description |
|------|-------------|
| `semantic_model_list` | List all semantic models |
| `semantic_model_get` | Get semantic model details |
| `semantic_model_create` | Create a semantic model with a BIM/JSON definition (LRO, supports file path reference) |
| `semantic_model_create_tmdl` | Create a semantic model with a TMDL definition (LRO, supports directory path reference) |
| `semantic_model_update` | Update semantic model name or description |
| `semantic_model_delete` | Delete a semantic model |
| `semantic_model_refresh` | Trigger a model refresh (Power BI API) |
| `semantic_model_execute_dax` | Execute a DAX query (Power BI API) |
| `semantic_model_get_definition` | Get model definition in TMSL/BIM JSON format (LRO) |
| `semantic_model_get_tmdl` | Get model definition in TMDL format (LRO) |
| `semantic_model_update_definition` | Update model definition from TMSL/BIM JSON (LRO, supports file path reference) |
| `semantic_model_update_tmdl` | Update model definition from TMDL files (LRO, supports directory path reference) |

### Report (10 tools)
| Tool | Description |
|------|-------------|
| `report_list` | List all reports |
| `report_get` | Get report details |
| `report_create` | Create a new report (LRO) |
| `report_update` | Update report name or description |
| `report_delete` | Delete a report |
| `report_clone` | Clone a report (Power BI API) |
| `report_export` | Export report to file format (Power BI API) |
| `report_get_export_status` | Check report export status |
| `report_get_definition` | Get report definition in PBIR or PBIR-Legacy format (LRO) |
| `report_update_definition` | Update report definition from parts (LRO, supports directory path reference) |

### Dataflow Gen2 (7 tools)
| Tool | Description |
|------|-------------|
| `dataflow_list` | List all Dataflow Gen2 items |
| `dataflow_get` | Get dataflow details |
| `dataflow_create` | Create a new dataflow |
| `dataflow_update` | Update dataflow name or description |
| `dataflow_delete` | Delete a dataflow |
| `dataflow_refresh` | Trigger a dataflow refresh |
| `dataflow_get_refresh_status` | Get refresh job status |

### Eventhouse (7 tools)
| Tool | Description |
|------|-------------|
| `eventhouse_list` | List all eventhouses |
| `eventhouse_get` | Get eventhouse details |
| `eventhouse_create` | Create a new eventhouse (LRO) |
| `eventhouse_update` | Update eventhouse name or description |
| `eventhouse_delete` | Delete an eventhouse |
| `eventhouse_get_sql_endpoint` | Get query service URI and connection details |
| `eventhouse_execute_kql` | Execute a KQL query against a KQL database |

### Eventstream (7 tools)
| Tool | Description |
|------|-------------|
| `eventstream_list` | List all eventstreams |
| `eventstream_get` | Get eventstream details |
| `eventstream_create` | Create a new eventstream (LRO) |
| `eventstream_update` | Update eventstream name or description |
| `eventstream_delete` | Delete an eventstream |
| `eventstream_get_definition` | Get eventstream definition (decoded) |
| `eventstream_update_definition` | Update eventstream definition (supports file path reference) |

### Reflex / Activator (6 tools)
| Tool | Description |
|------|-------------|
| `reflex_list` | List all Reflex (Activator) items |
| `reflex_get` | Get reflex details |
| `reflex_create` | Create a new reflex |
| `reflex_update` | Update reflex name or description |
| `reflex_delete` | Delete a reflex |
| `reflex_get_definition` | Get reflex definition (decoded) |

### GraphQL API (7 tools)
| Tool | Description |
|------|-------------|
| `graphql_api_list` | List all GraphQL API items |
| `graphql_api_get` | Get GraphQL API details |
| `graphql_api_create` | Create a new GraphQL API |
| `graphql_api_update` | Update GraphQL API name or description |
| `graphql_api_delete` | Delete a GraphQL API |
| `graphql_api_get_definition` | Get GraphQL schema definition |
| `graphql_api_execute_query` | Execute a GraphQL query |

### SQL Endpoint (4 tools)
| Tool | Description |
|------|-------------|
| `sql_endpoint_list` | List all SQL endpoints |
| `sql_endpoint_get` | Get SQL endpoint details |
| `sql_endpoint_get_connection_string` | Get TDS connection string |
| `sql_endpoint_execute_query` | Execute a T-SQL query against a SQL endpoint |

## License

AGPL-3.0
