# mcp-fabric-api

MCP (Model Context Protocol) server for the Microsoft Fabric REST APIs. Built for data engineers and data analysts who want to use AI assistants beyond Copilot — such as Claude, Claude Code, or any MCP-compatible client — to build and manage their Fabric components. Covers workspaces, lakehouses, warehouses, notebooks, pipelines, semantic models, reports, dataflows, eventhouses, eventstreams, reflexes, GraphQL APIs, SQL endpoints, and variable libraries.

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

**Guarded tools (51 total)** — every tool that creates, updates, or deletes workspace items:

| Domain | Guarded tools |
|--------|--------------|
| Workspace | `workspace_update`, `workspace_delete` |
| Lakehouse | `lakehouse_create`, `lakehouse_update`, `lakehouse_delete`, `lakehouse_load_table`, `lakehouse_create_shortcut` |
| Warehouse | `warehouse_create`, `warehouse_update`, `warehouse_delete` |
| Notebook | `notebook_create`, `notebook_update`, `notebook_delete`, `notebook_update_definition` |
| Pipeline | `pipeline_create`, `pipeline_update`, `pipeline_delete`, `pipeline_create_schedule`, `pipeline_update_schedule`, `pipeline_delete_schedule` |
| Semantic Model | `semantic_model_create_bim`, `semantic_model_create_tmdl`, `semantic_model_update_details`, `semantic_model_delete`, `semantic_model_update_bim`, `semantic_model_update_tmdl` |
| Report | `report_create`, `report_update`, `report_delete`, `report_clone`, `report_update_definition` |
| Dataflow | `dataflow_create`, `dataflow_update`, `dataflow_delete` |
| Eventhouse | `eventhouse_create`, `eventhouse_update`, `eventhouse_delete` |
| Eventstream | `eventstream_create`, `eventstream_update`, `eventstream_delete`, `eventstream_update_definition` |
| Reflex | `reflex_create`, `reflex_update`, `reflex_delete` |
| GraphQL API | `graphql_api_create`, `graphql_api_update`, `graphql_api_delete` |
| Variable Library | `variable_library_create`, `variable_library_update`, `variable_library_delete`, `variable_library_update_definition` |

**Not guarded:** Read operations (list, get, get_definition, get_bim, get_tmdl), query execution (DAX, KQL, SQL, GraphQL), run/refresh/cancel operations, and export operations.

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

### File-Based I/O

To avoid large payloads overwhelming MCP clients, definition tools use file paths instead of inline content. The server reads files from disk when sending definitions to Fabric, and writes files to disk when retrieving definitions from Fabric.

**Input tools** — the server reads definition files from the specified path and uploads to Fabric:

| Tool | Parameter | Description |
|------|-----------|-------------|
| `semantic_model_create_bim` | `definitionFilePath` | Path to model.bim JSON file |
| `semantic_model_update_bim` | `definitionFilePath` | Path to model.bim JSON file |
| `semantic_model_create_tmdl` | `filesDirectoryPath` | Directory of `.tmdl` and `.pbism` files |
| `semantic_model_update_tmdl` | `filesDirectoryPath` | Directory of `.tmdl` and `.pbism` files |
| `notebook_update_definition` | `contentFilePath` | Path to notebook content file (or inline `content`) |
| `eventstream_update_definition` | `contentFilePath` | Path to eventstream definition (or inline `content`) |
| `report_update_definition` | `partsDirectoryPath` | Directory of report definition files (or inline `parts`) |
| `variable_library_create` | `definitionDirectoryPath` | Directory of `.json` and `.platform` files |
| `variable_library_update_definition` | `definitionDirectoryPath` | Directory of `.json` and `.platform` files |

**Output tools** — the server retrieves definitions from Fabric and writes them to disk:

| Tool | Parameter | What gets written |
|------|-----------|-------------------|
| `semantic_model_get_bim` | `outputFilePath` | Single `model.bim` JSON file |
| `semantic_model_get_tmdl` | `outputDirectoryPath` | TMDL files preserving folder structure |
| `report_get_definition` | `outputDirectoryPath` | Report definition files (report.json, pages, visuals) |
| `eventstream_get_definition` | `outputDirectoryPath` | Eventstream definition files |
| `graphql_api_get_definition` | `outputDirectoryPath` | GraphQL schema definition files |
| `reflex_get_definition` | `outputDirectoryPath` | Reflex definition files |
| `variable_library_get_definition` | `outputDirectoryPath` | Variable library files (variables.json, valueSets/) |

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

## Tools (116 total)

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
| `semantic_model_get_details` | Get semantic model metadata (name, ID, description) — does not return the definition |
| `semantic_model_create_bim` | Create a semantic model from a BIM/JSON file (LRO). Reads `model.bim` from `definitionFilePath` |
| `semantic_model_create_tmdl` | Create a semantic model from TMDL files (LRO). Reads `.tmdl`/`.pbism` from `filesDirectoryPath` |
| `semantic_model_update_details` | Update semantic model name or description — does not modify the definition |
| `semantic_model_delete` | Delete a semantic model |
| `semantic_model_refresh` | Trigger a model refresh (Power BI API) |
| `semantic_model_execute_dax` | Execute a DAX query (Power BI API) |
| `semantic_model_get_bim` | Get definition in BIM/JSON format (LRO). Writes `model.bim` to `outputFilePath` |
| `semantic_model_get_tmdl` | Get definition in TMDL format (LRO). Writes TMDL files to `outputDirectoryPath` |
| `semantic_model_update_bim` | Update definition from BIM/JSON file (LRO). Reads `model.bim` from `definitionFilePath` |
| `semantic_model_update_tmdl` | Update definition from TMDL files (LRO). Reads `.tmdl`/`.pbism` from `filesDirectoryPath` |

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
| `report_get_definition` | Get report definition (LRO). Writes files to `outputDirectoryPath` |
| `report_update_definition` | Update report definition from parts or directory (LRO) |

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
| `eventstream_get_definition` | Get eventstream definition (LRO). Writes files to `outputDirectoryPath` |
| `eventstream_update_definition` | Update eventstream definition (supports file path reference) |

### Reflex / Activator (6 tools)
| Tool | Description |
|------|-------------|
| `reflex_list` | List all Reflex (Activator) items |
| `reflex_get` | Get reflex details |
| `reflex_create` | Create a new reflex |
| `reflex_update` | Update reflex name or description |
| `reflex_delete` | Delete a reflex |
| `reflex_get_definition` | Get reflex definition (LRO). Writes files to `outputDirectoryPath` |

### GraphQL API (7 tools)
| Tool | Description |
|------|-------------|
| `graphql_api_list` | List all GraphQL API items |
| `graphql_api_get` | Get GraphQL API details |
| `graphql_api_create` | Create a new GraphQL API |
| `graphql_api_update` | Update GraphQL API name or description |
| `graphql_api_delete` | Delete a GraphQL API |
| `graphql_api_get_definition` | Get GraphQL schema definition (LRO). Writes files to `outputDirectoryPath` |
| `graphql_api_execute_query` | Execute a GraphQL query |

### SQL Endpoint (4 tools)
| Tool | Description |
|------|-------------|
| `sql_endpoint_list` | List all SQL endpoints |
| `sql_endpoint_get` | Get SQL endpoint details |
| `sql_endpoint_get_connection_string` | Get TDS connection string |
| `sql_endpoint_execute_query` | Execute a T-SQL query against a SQL endpoint |

### Variable Library (7 tools)
| Tool | Description |
|------|-------------|
| `variable_library_list` | List all variable libraries in a workspace |
| `variable_library_get` | Get variable library details including active value set name |
| `variable_library_create` | Create a variable library, optionally with definition files from `definitionDirectoryPath` (LRO) |
| `variable_library_update` | Update name, description, or active value set |
| `variable_library_delete` | Delete a variable library |
| `variable_library_get_definition` | Get definition (LRO). Writes files (variables.json, valueSets/) to `outputDirectoryPath` |
| `variable_library_update_definition` | Update definition from directory of `.json` and `.platform` files (LRO) |

## License

AGPL-3.0
