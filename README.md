# mcp-fabric-api

MCP (Model Context Protocol) server for the Microsoft Fabric REST APIs. Built for data engineers and data analysts who want to use AI assistants beyond Copilot — such as Claude, Claude Code, or any MCP-compatible client — to build and manage their Fabric components. Covers workspaces, lakehouses, warehouses, notebooks, pipelines, semantic models, reports, dataflows, eventhouses, eventstreams, reflexes, GraphQL APIs, SQL endpoints, variable libraries, git integration, deployment pipelines, mirrored databases, KQL databases, ML models, ML experiments, copy jobs, external data shares, and environments (Spark compute + libraries, with notebook attach/detach).

> **Safe by default:** This server blocks all destructive operations (create, update, delete) until you explicitly configure the `WRITABLE_WORKSPACES` environment variable. Read operations always work. Set `WRITABLE_WORKSPACES="*"` to allow writes to all workspaces, or use patterns to limit access. See [Workspace Safety Guard](#workspace-safety-guard) for details.

## Prerequisites

- Node.js 18+
- Access to a Microsoft Fabric workspace
- One of:
  - Azure CLI (`az login`) — easiest on Windows
  - Azure app registration with device code flow enabled — best for Mac / Claude Desktop
  - Service principal credentials — best for headless / automated scenarios

## Quick Start

**Windows (Azure CLI):**

```bash
az login
npx @einlogic/mcp-fabric-api
```

**Mac / Claude Desktop (Device Code):**

```bash
AUTH_METHOD=device-code AZURE_CLIENT_ID=your-app-id AZURE_TENANT_ID=your-tenant-id npx @einlogic/mcp-fabric-api
```

On first API call, a sign-in URL and code will appear in the logs. Open the URL in your browser, enter the code, and authenticate.

## Setup

### Claude Desktop

Add to your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

**Windows (uses Azure CLI credentials):**

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

**macOS (uses device code flow):**

```json
{
  "mcpServers": {
    "fabric": {
      "command": "npx",
      "args": ["-y", "@einlogic/mcp-fabric-api"],
      "env": {
        "AUTH_METHOD": "device-code",
        "AZURE_CLIENT_ID": "your-app-client-id",
        "AZURE_TENANT_ID": "your-tenant-id"
      }
    }
  }
}
```

When the server starts, check the Claude Desktop logs for a sign-in prompt:
- **macOS:** `~/Library/Logs/Claude/mcp-server-fabric.log`
- **Windows:** `%APPDATA%\Claude\logs\mcp-server-fabric.log`

The prompt will say: *"To sign in, use a web browser to open https://microsoft.com/devicelogin and enter the code XXXXXXX"*. Complete the sign-in once and the token is cached for the session.

### Claude Code CLI

**Windows:**
```bash
claude mcp add fabric -- npx -y @einlogic/mcp-fabric-api
```

**macOS:**
```bash
claude mcp add fabric -e AUTH_METHOD=device-code -e AZURE_CLIENT_ID=your-app-id -e AZURE_TENANT_ID=your-tenant-id -- npx -y @einlogic/mcp-fabric-api
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

### Authentication Methods

The server supports multiple authentication methods via the `AUTH_METHOD` environment variable. Choose the method that fits your platform and scenario:

| Method | `AUTH_METHOD` | Required env vars | Best for |
|--------|--------------|-------------------|----------|
| Azure CLI (default) | `default` | None | Windows with `az login` |
| Device Code | `device-code` | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` | **Mac / Claude Desktop** |
| Client Secret | `client-secret` | `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` | Headless / automated |
| Interactive Browser | `interactive-browser` | None (optional: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`) | Systems with browser access |

**Default (Azure CLI):** Uses the `DefaultAzureCredential` chain from the Azure Identity SDK. On a developer machine this picks up credentials from `az login`. No extra configuration needed. This is the original behavior and works best on Windows where Claude Desktop can access the Azure CLI token cache.

**Device Code:** On first API call, prints a URL and one-time code to stderr. You open the URL in any browser, enter the code, and sign in with your Azure account. The token is cached in memory for the session. This is the recommended method for **Mac users with Claude Desktop**, because the Claude Desktop process on macOS cannot access the Azure CLI token cache.

To use device code flow, you need an Azure app registration with **"Allow public client flows"** enabled:
1. Go to [Azure Portal](https://portal.azure.com) > App registrations > New registration
2. Name it (e.g., "Fabric MCP") and register
3. Under **Authentication** > **Advanced settings**, set **"Allow public client flows"** to **Yes**
4. Under **API permissions**, add `https://api.fabric.microsoft.com/Workspace.ReadWrite.All` (or the scopes your tools need)
5. Copy the **Application (client) ID** and your **Directory (tenant) ID**

**Client Secret:** Uses a service principal with client credentials. Requires an Azure app registration with a client secret. Suitable for CI/CD pipelines, automated scripts, or any headless environment where interactive sign-in is not possible.

**Interactive Browser:** Opens a browser window for OAuth sign-in. Works on systems where the server process can launch a browser. Optional `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` can be provided to target a specific app and tenant.

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

**Guarded tools (131 total)** — every tool that creates, updates, or deletes workspace items:

| Domain | Guarded tools |
|--------|--------------|
| Workspace | `workspace_update`, `workspace_delete`, `workspace_add_role_assignment`, `workspace_update_role_assignment`, `workspace_delete_role_assignment` |
| Folder | `folder_create`, `folder_update`, `folder_move`, `folder_delete` |
| Tags | `item_apply_tags`, `item_unapply_tags` |
| OneLake Data Access Security | `onelake_set_data_access_role`, `onelake_delete_data_access_role` |
| SQL Database | `sql_database_create`, `sql_database_update`, `sql_database_delete`, `sql_database_update_definition`, `sql_database_start_mirroring`, `sql_database_stop_mirroring` |
| KQL Queryset | `kql_queryset_create`, `kql_queryset_update`, `kql_queryset_delete`, `kql_queryset_update_definition` |
| KQL Dashboard | `kql_dashboard_create`, `kql_dashboard_update`, `kql_dashboard_delete`, `kql_dashboard_update_definition` |
| Lakehouse | `lakehouse_create`, `lakehouse_update`, `lakehouse_delete`, `lakehouse_load_table`, `lakehouse_create_shortcut`, `lakehouse_update_definition`, `lakehouse_delete_shortcut`, `lakehouse_create_folder`, `lakehouse_upload_file`, `lakehouse_move_file`, `lakehouse_delete_file` |
| Warehouse | `warehouse_create`, `warehouse_update`, `warehouse_delete`, `warehouse_update_definition` |
| Notebook | `notebook_create`, `notebook_update`, `notebook_delete`, `notebook_update_definition`, `notebook_attach_environment`, `notebook_detach_environment` |
| Pipeline | `pipeline_create`, `pipeline_update`, `pipeline_delete`, `pipeline_create_schedule`, `pipeline_update_schedule`, `pipeline_delete_schedule`, `pipeline_update_definition` |
| Semantic Model | `semantic_model_create_bim`, `semantic_model_create_tmdl`, `semantic_model_update_details`, `semantic_model_delete`, `semantic_model_update_bim`, `semantic_model_update_tmdl`, `semantic_model_take_over` |
| Report | `report_create_definition`, `report_update`, `report_delete`, `report_clone`, `report_update_definition`, `report_rebind` |
| Dataflow | `dataflow_create`, `dataflow_update`, `dataflow_delete` |
| Eventhouse | `eventhouse_create`, `eventhouse_update`, `eventhouse_delete` |
| Eventstream | `eventstream_create`, `eventstream_update`, `eventstream_delete`, `eventstream_update_definition` |
| Reflex | `reflex_create`, `reflex_update`, `reflex_delete`, `reflex_update_definition` |
| GraphQL API | `graphql_api_create`, `graphql_api_update`, `graphql_api_delete` |
| Variable Library | `variable_library_create`, `variable_library_update`, `variable_library_delete`, `variable_library_update_definition` |
| Git Integration | `git_connect`, `git_disconnect`, `git_initialize_connection`, `git_commit_to_git`, `git_update_from_git`, `git_update_credentials` |
| Deployment Pipeline | `deployment_pipeline_assign_workspace`, `deployment_pipeline_unassign_workspace`, `deployment_pipeline_deploy` |
| Mirrored Database | `mirrored_database_create`, `mirrored_database_update`, `mirrored_database_delete`, `mirrored_database_update_definition`, `mirrored_database_start_mirroring`, `mirrored_database_stop_mirroring` |
| KQL Database | `kql_database_create`, `kql_database_update`, `kql_database_delete`, `kql_database_update_definition` |
| ML Model | `ml_model_create`, `ml_model_update`, `ml_model_delete` |
| ML Experiment | `ml_experiment_create`, `ml_experiment_update`, `ml_experiment_delete` |
| Copy Job | `copy_job_create`, `copy_job_update`, `copy_job_delete`, `copy_job_update_definition` |
| External Data Share | `external_data_share_create`, `external_data_share_revoke` |
| Environment | `environment_create`, `environment_update`, `environment_update_definition`, `environment_delete`, `environment_publish`, `environment_cancel_publish`, `environment_import_staging_external_libraries`, `environment_upload_staging_custom_library`, `environment_delete_staging_custom_library`, `environment_remove_staging_external_library`, `environment_update_staging_spark_compute` |

**Not guarded:** Read operations (list, get, get_definition, get_bim, get_tmdl), query execution (DAX, KQL, SQL, GraphQL), run/refresh/cancel operations, export operations, and deployment pipeline CRUD (tenant-level, not workspace-scoped).

**Claude Desktop config with guard (Windows):**
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

**Claude Desktop config with guard (macOS):**
```json
{
  "mcpServers": {
    "fabric": {
      "command": "npx",
      "args": ["-y", "@einlogic/mcp-fabric-api"],
      "env": {
        "AUTH_METHOD": "device-code",
        "AZURE_CLIENT_ID": "your-app-client-id",
        "AZURE_TENANT_ID": "your-tenant-id",
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

### Debug Logging

Enable verbose debug logging to diagnose API errors, inspect request/response details, and trace long-running operations. All log output goes to `stderr` (visible in Claude Desktop's log files, never interferes with JSON-RPC on stdout).

Set the `LOG_LEVEL` environment variable to `debug`:

**Claude Desktop config:**
```json
{
  "mcpServers": {
    "fabric": {
      "command": "npx",
      "args": ["-y", "@einlogic/mcp-fabric-api"],
      "env": {
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

**Claude Code CLI:**
```bash
LOG_LEVEL=debug claude mcp add fabric -- npx -y @einlogic/mcp-fabric-api
```

**What gets logged at debug level:**

| Category | Details logged |
|----------|---------------|
| HTTP requests | Method, full URL, request body size in bytes |
| HTTP responses | Status code, duration (ms), `x-ms-request-id` header |
| Definition uploads | Part paths, payload types, payload sizes — never payload content |
| API errors | Full error body including `errorCode`, `details[]`, `innererror`, `relatedResource`, `x-ms-request-id` |
| LRO polling | Operation ID, poll count, elapsed time, final status |
| Pagination | Page count, items per page, total items |
| SQL/KQL queries | Server, database, duration, column/row counts — never query text or result data |
| Rate limiting | Retry-after duration, affected endpoint |

**Compliance:** Debug logging never captures actual data content — no query text, no query results, no definition payloads, no bearer tokens. Only structural metadata (URLs, sizes, counts, timing, error details) is logged.

**Viewing logs in Claude Desktop:**

- **macOS:** `~/Library/Logs/Claude/mcp-server-fabric.log`
- **Windows:** `%APPDATA%\Claude\logs\mcp-server-fabric.log`

You can also tail the log in real time:
```bash
# macOS
tail -f ~/Library/Logs/Claude/mcp-server-fabric.log

# Windows (PowerShell)
Get-Content "$env:APPDATA\Claude\logs\mcp-server-fabric.log" -Wait
```

The `x-ms-request-id` value logged with every API error is the key identifier needed when opening a support case with Microsoft for Fabric API issues.

### Read vs Write Tool Annotations

Every tool declares MCP [`ToolAnnotations`](https://modelcontextprotocol.io/specification/server/tools#annotations) so MCP clients can distinguish read-only tools from mutations when presenting them in a configuration UI. This lets users enable all read tools in a single toggle while requiring explicit approval for writes.

| Annotation | Meaning | Typical tool names |
|------------|---------|--------------------|
| `readOnlyHint: true` | Pure read, no state change | `*_list`, `*_get`, `*_get_definition`, DAX queries, export operations |
| `readOnlyHint: false, destructiveHint: false` | Creates or updates state | `*_create`, `*_update`, `*_run`, `*_refresh`, `*_publish`, `*_import`, `*_upload` |
| `readOnlyHint: false, destructiveHint: true` | Deletes, cancels, or removes | `*_delete`, `*_cancel_run`, `*_remove_*`, `*_revoke`, `*_disconnect`, `*_detach_*` |

All 273 tools carry these hints. The workspace safety guard (`WRITABLE_WORKSPACES`) still applies independently on top of whatever the client permits.

### File-Based I/O

To avoid large payloads overwhelming MCP clients, definition tools use file paths instead of inline content. The server reads files from disk when sending definitions to Fabric, and writes files to disk when retrieving definitions from Fabric.

**Input tools** — the server reads definition files from the specified path and uploads to Fabric:

| Tool | Parameter | Description |
|------|-----------|-------------|
| `semantic_model_create_bim` | `definitionFilePath` | Path to model.bim JSON file |
| `semantic_model_update_bim` | `definitionFilePath` | Path to model.bim JSON file |
| `semantic_model_create_tmdl` | `filesDirectoryPath` | Directory of `.tmdl` and `.pbism` files |
| `semantic_model_update_tmdl` | `filesDirectoryPath` | Directory of `.tmdl` and `.pbism` files |
| `notebook_update_definition` | `definitionDirectoryPath` | Directory containing notebook definition files |
| `eventstream_update_definition` | `definitionDirectoryPath` | Directory containing eventstream definition files |
| `report_create_definition` | `definitionDirectoryPath` | Directory of PBIR report definition files |
| `report_update_definition` | `definitionDirectoryPath` | Directory of PBIR report definition files |
| `variable_library_create` | `definitionDirectoryPath` | Directory of `.json` and `.platform` files |
| `variable_library_update_definition` | `definitionDirectoryPath` | Directory of `.json` and `.platform` files |
| `lakehouse_update_definition` | `partsDirectoryPath` | Directory of definition files (or inline `parts`) |
| `warehouse_update_definition` | `partsDirectoryPath` | Directory of definition files (or inline `parts`) |
| `pipeline_update_definition` | `partsDirectoryPath` | Directory of definition files (or inline `parts`) |
| `reflex_update_definition` | `partsDirectoryPath` | Directory of definition files (or inline `parts`) |
| `mirrored_database_update_definition` | `partsDirectoryPath` | Directory of definition files (or inline `parts`) |
| `kql_database_update_definition` | `partsDirectoryPath` | Directory of definition files (or inline `parts`) |
| `copy_job_update_definition` | `partsDirectoryPath` | Directory of definition files (or inline `parts`) |
| `sql_database_update_definition` | `partsDirectoryPath` | Directory of `.dacpac` or `.sqlproj`/`.sql` files (or inline `parts`) |
| `kql_queryset_update_definition` | `partsDirectoryPath` | Directory of definition files (or inline `parts`) |
| `kql_dashboard_update_definition` | `partsDirectoryPath` | Directory of definition files (or inline `parts`) |
| `environment_create` | `definitionDirectoryPath` (optional) | Directory of environment definition files to seed on create |
| `environment_update_definition` | `definitionDirectoryPath` | Directory of environment definition files |
| `environment_import_staging_external_libraries` | `yamlFilePath` | Path to an `environment.yml` file (replaces external library list) |
| `environment_upload_staging_custom_library` | `libraryFilePath` | Path to `.jar` / `.py` / `.whl` / `.tar.gz` (max 100 MB) |
| `lakehouse_upload_file` | `localFilePath` | Any local file (binary-safe), uploaded to the lakehouse's Files section via the OneLake Data Access API |

**Output tools** — the server retrieves definitions from Fabric and writes them to disk:

| Tool | Parameter | What gets written |
|------|-----------|-------------------|
| `semantic_model_get_bim` | `outputFilePath` | Single `model.bim` JSON file |
| `semantic_model_get_tmdl` | `outputDirectoryPath` | TMDL files preserving folder structure |
| `notebook_get_definition` | `outputDirectoryPath` | Notebook definition files |
| `lakehouse_get_definition` | `outputDirectoryPath` | Lakehouse definition files |
| `warehouse_get_definition` | `outputDirectoryPath` | Warehouse definition files |
| `pipeline_get_definition` | `outputDirectoryPath` | Pipeline definition files |
| `report_get_definition` | `outputDirectoryPath` | Report definition files (report.json, pages, visuals) |
| `dataflow_get_definition` | `outputDirectoryPath` | Dataflow definition files |
| `eventstream_get_definition` | `outputDirectoryPath` | Eventstream definition files |
| `graphql_api_get_definition` | `outputDirectoryPath` | GraphQL schema definition files |
| `reflex_get_definition` | `outputDirectoryPath` | Reflex definition files |
| `variable_library_get_definition` | `outputDirectoryPath` | Variable library files (variables.json, valueSets/) |
| `mirrored_database_get_definition` | `outputDirectoryPath` | Mirrored database definition files |
| `kql_database_get_definition` | `outputDirectoryPath` | KQL database definition files |
| `lakehouse_download_file` | `localFilePath` | Any file (binary-safe) from the lakehouse's Files section, via the OneLake Data Access API |
| `notebook_get_livy_log` | `outputFilePath` | Raw Livy/driver/executor log text for a notebook's Spark session |
| `copy_job_get_definition` | `outputDirectoryPath` | Copy job definition files |
| `environment_get_definition` | `outputDirectoryPath` | Environment definition files |
| `sql_database_get_definition` | `outputDirectoryPath` | SQL database definition files (`.dacpac` or `.sqlproj`/`.sql`) |
| `kql_queryset_get_definition` | `outputDirectoryPath` | KQL queryset definition files |
| `kql_dashboard_get_definition` | `outputDirectoryPath` | KQL dashboard definition files |
| `environment_export_staging_external_libraries` | `outputFilePath` | Staging `environment.yml` |
| `environment_export_published_external_libraries` | `outputFilePath` | Published `environment.yml` |

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

## Tools (273 total)

### Auth (4 tools)
| Tool | Description |
|------|-------------|
| `auth_get_current_account` | Show current Azure identity, tenant, and token expiry |
| `auth_list_available_accounts` | List subscriptions/tenants from local `az login` state (does not query Entra) |
| `auth_switch_tenant` | Switch to a different Azure tenant (with rollback on failure) |
| `auth_clear_token_cache` | Clear cached tokens to force re-acquisition |

### Workspace (11 tools)
| Tool | Description |
|------|-------------|
| `workspace_list` | List all accessible Fabric workspaces |
| `workspace_get` | Get details of a specific workspace |
| `workspace_create` | Create a new workspace |
| `workspace_update` | Update a workspace's name or description |
| `workspace_delete` | Delete a workspace |
| `workspace_list_items` | List all items in a workspace (with optional type filter) |
| `workspace_list_role_assignments` | List who has Admin/Member/Contributor/Viewer access to a workspace |
| `workspace_get_role_assignment` | Get a specific role assignment by ID |
| `workspace_add_role_assignment` | Grant a user, group, service principal, or the entire tenant a workspace role |
| `workspace_update_role_assignment` | Change a principal's workspace role |
| `workspace_delete_role_assignment` | Remove a principal's workspace role assignment |

### Lakehouse (21 tools)
| Tool | Description |
|------|-------------|
| `lakehouse_list` | List all lakehouses in a workspace |
| `lakehouse_get` | Get lakehouse details (SQL endpoint, OneLake paths) |
| `lakehouse_create` | Create a new lakehouse (LRO, schemas enabled by default) |
| `lakehouse_update` | Update lakehouse name or description |
| `lakehouse_delete` | Delete a lakehouse |
| `lakehouse_list_tables` | List all tables in a lakehouse (falls back to SQL endpoint for schema-enabled lakehouses) |
| `lakehouse_load_table` | Load data into a table from OneLake (LRO). Not supported for schema-enabled lakehouses |
| `lakehouse_create_shortcut` | Create a OneLake shortcut (file, folder, table, or schema level) with support for multiple target types |
| `lakehouse_get_sql_endpoint` | Get SQL endpoint details |
| `lakehouse_get_definition` | Get lakehouse definition (LRO). Writes files to `outputDirectoryPath` |
| `lakehouse_update_definition` | Update lakehouse definition (LRO). Reads from `partsDirectoryPath` or inline `parts` |
| `lakehouse_list_shortcuts` | List all OneLake shortcuts in a lakehouse |
| `lakehouse_get_shortcut` | Get details of a specific OneLake shortcut |
| `lakehouse_delete_shortcut` | Delete a OneLake shortcut |
| `lakehouse_list_files` | List files/folders under a path in the Files section (OneLake Data Access API) |
| `lakehouse_get_file_properties` | Get metadata (size, last modified, etag) for a file or folder in Files |
| `lakehouse_create_folder` | Create a folder in the Files section |
| `lakehouse_upload_file` | Upload a local file into the Files section |
| `lakehouse_download_file` | Download a file from the Files section to local disk |
| `lakehouse_move_file` | Move or rename a file or folder within the Files section |
| `lakehouse_delete_file` | Delete a file or folder from the Files section |

### Warehouse (9 tools)
| Tool | Description |
|------|-------------|
| `warehouse_list` | List all warehouses in a workspace |
| `warehouse_get` | Get warehouse details including connection string and provisioning status |
| `warehouse_create` | Create a new warehouse (LRO) |
| `warehouse_update` | Update warehouse name or description |
| `warehouse_delete` | Delete a warehouse |
| `warehouse_get_sql_endpoint` | Get SQL connection details for a warehouse |
| `warehouse_list_tables` | List all tables in a warehouse |
| `warehouse_get_definition` | Get warehouse definition (LRO). Writes files to `outputDirectoryPath` |
| `warehouse_update_definition` | Update warehouse definition (LRO). Reads from `partsDirectoryPath` or inline `parts` |

### Notebook (15 tools)
| Tool | Description |
|------|-------------|
| `notebook_list` | List all notebooks in a workspace |
| `notebook_get` | Get notebook details |
| `notebook_create` | Create a new notebook (LRO) |
| `notebook_update` | Update notebook name or description |
| `notebook_delete` | Delete a notebook |
| `notebook_get_definition` | Get notebook definition (LRO). Writes files to `outputDirectoryPath` |
| `notebook_update_definition` | Update notebook definition (LRO). Reads files from `definitionDirectoryPath` |
| `notebook_run` | Run a notebook on demand |
| `notebook_get_run_status` | Get notebook run status |
| `notebook_cancel_run` | Cancel a running notebook |
| `notebook_list_livy_sessions` | List Spark Livy sessions for a notebook (state, compute sizing, durations) |
| `notebook_get_livy_session` | Get details of a specific Livy session |
| `notebook_get_livy_log` | Download the Livy/driver/executor log for a Livy session to local disk — the driver log is the closest thing to notebook "results" available via API (unstructured print/display output, stack traces) |
| `notebook_attach_environment` | Attach a Fabric Environment to a notebook by mutating its definition metadata (handles both `.py` and `.ipynb` notebooks) |
| `notebook_detach_environment` | Remove the attached environment from a notebook |

### Pipeline (16 tools)
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
| `pipeline_query_activity_runs` | Get per-activity run details for a pipeline run (status, input, output, error per activity) |
| `pipeline_list_schedules` | List pipeline schedules |
| `pipeline_create_schedule` | Create a pipeline schedule |
| `pipeline_update_schedule` | Update a pipeline schedule |
| `pipeline_delete_schedule` | Delete a pipeline schedule |
| `pipeline_get_definition` | Get pipeline definition (LRO). Writes files to `outputDirectoryPath` |
| `pipeline_update_definition` | Update pipeline definition (LRO). Reads from `partsDirectoryPath` or inline `parts` |

### Semantic Model (15 tools)
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
| `semantic_model_get_refresh_history` | Get refresh history (Power BI API) |
| `semantic_model_take_over` | Take over ownership of a semantic model (Power BI API) |
| `semantic_model_get_datasources` | Get data sources of a semantic model (Power BI API) |

### Report (13 tools)
| Tool | Description |
|------|-------------|
| `report_list` | List all reports |
| `report_get` | Get report details |
| `report_create_definition` | Create a new report from PBIR definition files (LRO). Reads from `definitionDirectoryPath` |
| `report_update` | Update report name or description |
| `report_delete` | Delete a report |
| `report_clone` | Clone a report (Power BI API) |
| `report_export` | Export report to file format (PDF, PPTX, PNG, etc.) via Power BI API |
| `report_get_export_status` | Check report export status |
| `report_get_definition` | Get report definition (LRO). Writes files to `outputDirectoryPath` |
| `report_update_definition` | Update report definition from PBIR directory (LRO). Reads from `definitionDirectoryPath` |
| `report_rebind` | Rebind a report to a different semantic model/dataset (Power BI API) |
| `report_get_pages` | Get the list of pages in a report (Power BI API) |
| `report_get_datasources` | Get data sources used by a report (Power BI API) |

### Dataflow Gen2 (8 tools)
| Tool | Description |
|------|-------------|
| `dataflow_list` | List all Dataflow Gen2 items |
| `dataflow_get` | Get dataflow details |
| `dataflow_create` | Create a new dataflow |
| `dataflow_update` | Update dataflow name or description |
| `dataflow_delete` | Delete a dataflow |
| `dataflow_refresh` | Trigger a dataflow refresh |
| `dataflow_get_refresh_status` | Get refresh job status |
| `dataflow_get_definition` | Get dataflow definition (LRO). Writes files to `outputDirectoryPath` |

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
| `eventstream_update_definition` | Update eventstream definition (LRO). Reads from `definitionDirectoryPath` |

### Reflex / Activator (7 tools)
| Tool | Description |
|------|-------------|
| `reflex_list` | List all Reflex (Activator) items |
| `reflex_get` | Get reflex details |
| `reflex_create` | Create a new reflex |
| `reflex_update` | Update reflex name or description |
| `reflex_delete` | Delete a reflex |
| `reflex_get_definition` | Get reflex definition (LRO). Writes files to `outputDirectoryPath` |
| `reflex_update_definition` | Update reflex definition (LRO). Reads from `partsDirectoryPath` or inline `parts` |

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
| `sql_endpoint_execute_query` | Execute a T-SQL query against a lakehouse or warehouse SQL endpoint |

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

### Git Integration (9 tools)
| Tool | Description |
|------|-------------|
| `git_get_connection` | Get Git connection details for a workspace |
| `git_get_status` | Get Git status of items (sync state between workspace and remote) |
| `git_connect` | Connect a workspace to a Git repository (Azure DevOps or GitHub) |
| `git_disconnect` | Disconnect a workspace from its Git repository |
| `git_initialize_connection` | Initialize a Git connection after connecting (LRO) |
| `git_commit_to_git` | Commit workspace changes to the connected Git repository (LRO) |
| `git_update_from_git` | Update workspace from the connected Git repository (LRO) |
| `git_get_credentials` | Get Git credentials configuration for the current user |
| `git_update_credentials` | Update Git credentials configuration for the current user |

### Deployment Pipeline (12 tools)
| Tool | Description |
|------|-------------|
| `deployment_pipeline_list` | List all deployment pipelines accessible to the user |
| `deployment_pipeline_get` | Get details of a specific deployment pipeline |
| `deployment_pipeline_create` | Create a new deployment pipeline |
| `deployment_pipeline_update` | Update deployment pipeline name or description |
| `deployment_pipeline_delete` | Delete a deployment pipeline |
| `deployment_pipeline_list_stages` | List all stages in a deployment pipeline |
| `deployment_pipeline_list_stage_items` | List all items in a specific stage |
| `deployment_pipeline_assign_workspace` | Assign a workspace to a pipeline stage |
| `deployment_pipeline_unassign_workspace` | Unassign a workspace from a pipeline stage |
| `deployment_pipeline_deploy` | Deploy items from one stage to another (LRO) |
| `deployment_pipeline_list_operations` | List operations (deployment history) |
| `deployment_pipeline_get_operation` | Get details of a specific deployment operation |

### Mirrored Database (11 tools)
| Tool | Description |
|------|-------------|
| `mirrored_database_list` | List all mirrored databases in a workspace |
| `mirrored_database_get` | Get details of a specific mirrored database |
| `mirrored_database_create` | Create a new mirrored database (LRO) |
| `mirrored_database_update` | Update mirrored database name or description |
| `mirrored_database_delete` | Delete a mirrored database |
| `mirrored_database_get_definition` | Get mirrored database definition (LRO). Writes files to `outputDirectoryPath` |
| `mirrored_database_update_definition` | Update definition (LRO). Reads from `partsDirectoryPath` or inline `parts` |
| `mirrored_database_start_mirroring` | Start mirroring for a mirrored database |
| `mirrored_database_stop_mirroring` | Stop mirroring for a mirrored database |
| `mirrored_database_get_mirroring_status` | Get the mirroring status |
| `mirrored_database_get_tables_mirroring_status` | Get mirroring status of individual tables |

### KQL Database (7 tools)
| Tool | Description |
|------|-------------|
| `kql_database_list` | List all KQL databases in a workspace |
| `kql_database_get` | Get details of a specific KQL database |
| `kql_database_create` | Create a new KQL database (LRO). Requires a parent eventhouse |
| `kql_database_update` | Update KQL database name or description |
| `kql_database_delete` | Delete a KQL database |
| `kql_database_get_definition` | Get KQL database definition (LRO). Writes files to `outputDirectoryPath` |
| `kql_database_update_definition` | Update definition (LRO). Reads from `partsDirectoryPath` or inline `parts` |

### ML Model (5 tools)
| Tool | Description |
|------|-------------|
| `ml_model_list` | List all ML models in a workspace |
| `ml_model_get` | Get details of a specific ML model |
| `ml_model_create` | Create a new ML model (LRO) |
| `ml_model_update` | Update ML model name or description |
| `ml_model_delete` | Delete an ML model |

### ML Experiment (5 tools)
| Tool | Description |
|------|-------------|
| `ml_experiment_list` | List all ML experiments in a workspace |
| `ml_experiment_get` | Get details of a specific ML experiment |
| `ml_experiment_create` | Create a new ML experiment (LRO) |
| `ml_experiment_update` | Update ML experiment name or description |
| `ml_experiment_delete` | Delete an ML experiment |

### Copy Job (11 tools)
| Tool | Description |
|------|-------------|
| `copy_job_list` | List all copy jobs in a workspace |
| `copy_job_get` | Get details of a specific copy job |
| `copy_job_create` | Create a new copy job |
| `copy_job_update` | Update copy job name or description |
| `copy_job_delete` | Delete a copy job |
| `copy_job_get_definition` | Get copy job definition (LRO). Writes files to `outputDirectoryPath` |
| `copy_job_update_definition` | Update definition (LRO). Reads from `partsDirectoryPath` or inline `parts` |
| `copy_job_run` | Run a copy job on demand |
| `copy_job_get_run_status` | Get copy job run status |
| `copy_job_cancel_run` | Cancel a running copy job |
| `copy_job_list_runs` | List all run instances for a copy job |

### External Data Share (4 tools)
| Tool | Description |
|------|-------------|
| `external_data_share_list` | List all external data shares for an item |
| `external_data_share_get` | Get details of a specific external data share |
| `external_data_share_create` | Create a new external data share for an item |
| `external_data_share_revoke` | Revoke an external data share |

### Environment (20 tools)

Fabric Environments are the attachable runtime unit for notebooks and Spark job definitions — they bundle a runtime version, a Spark compute configuration, and a set of libraries. Tools cover the full CRUD surface plus the staging/publish lifecycle.

| Tool | Description |
|------|-------------|
| `environment_list` | List all environments in a workspace |
| `environment_get` | Get environment metadata including publish state |
| `environment_create` | Create a new environment (optionally seeded with a definition from `definitionDirectoryPath`) |
| `environment_update` | Update environment display name or description |
| `environment_delete` | Delete an environment |
| `environment_get_definition` | Get the environment public definition (LRO). Writes files to `outputDirectoryPath` |
| `environment_update_definition` | Override the environment public definition (LRO). Reads from `definitionDirectoryPath` |
| `environment_publish` | Trigger a publish to make staging changes effective (LRO) |
| `environment_cancel_publish` | Cancel an ongoing publish operation |
| `environment_list_staging_libraries` | List staging libraries (published + pending) |
| `environment_export_staging_external_libraries` | Export staging external libraries as `environment.yml` to `outputFilePath` |
| `environment_import_staging_external_libraries` | Upload `environment.yml` from `yamlFilePath` to replace the external library list |
| `environment_upload_staging_custom_library` | Upload a `.jar` / `.py` / `.whl` / `.tar.gz` from `libraryFilePath` (max 100 MB) |
| `environment_delete_staging_custom_library` | Delete a custom library from staging by filename |
| `environment_remove_staging_external_library` | Remove a single external library from staging (one at a time) |
| `environment_get_staging_spark_compute` | Get the staging Spark compute configuration |
| `environment_update_staging_spark_compute` | Update staging Spark compute (pool, cores, memory, runtime, sparkProperties) |
| `environment_list_published_libraries` | List published (currently effective) libraries |
| `environment_get_published_spark_compute` | Get published Spark compute configuration |
| `environment_export_published_external_libraries` | Export published external libraries as `environment.yml` to `outputFilePath` |

### Folder (6 tools, preview API)

In-workspace folder hierarchy for organizing items.

| Tool | Description |
|------|-------------|
| `folder_list` | List folders in a workspace, optionally scoped to a subtree |
| `folder_get` | Get details of a specific folder |
| `folder_create` | Create a folder (optionally nested under a parent folder) |
| `folder_update` | Rename a folder |
| `folder_move` | Move a folder to a different parent (or to the workspace root) |
| `folder_delete` | Delete a folder |

### Tags (3 tools)

Tenant-wide tags applied to items for categorization and discovery.

| Tool | Description |
|------|-------------|
| `tag_list` | List all tags defined in the tenant |
| `item_apply_tags` | Apply one or more existing tags to a workspace item |
| `item_unapply_tags` | Remove one or more tags from a workspace item |

### Catalog (1 tool, preview API)

| Tool | Description |
|------|-------------|
| `catalog_search` | Search for Fabric items across every workspace the caller can access, without needing to know which workspace they're in |

### OneLake Data Access Security (4 tools, preview API)

Fine-grained, table/folder-level read access roles inside a Lakehouse (or other OneLake-backed item) — finer-grained than workspace roles.

| Tool | Description |
|------|-------------|
| `onelake_list_data_access_roles` | List data access roles defined on an item |
| `onelake_get_data_access_role` | Get details of a specific role |
| `onelake_set_data_access_role` | Create or update (upsert) a single role without touching other roles on the item |
| `onelake_delete_data_access_role` | Delete a role by name |

### SQL Database (10 tools)

Fabric's native transactional SQL database item (OLTP), distinct from Warehouse (OLAP).

| Tool | Description |
|------|-------------|
| `sql_database_list` | List all SQL databases in a workspace |
| `sql_database_get` | Get database details including connection string |
| `sql_database_create` | Create a new database (fresh, or restored from a source/deleted database via `creationPayload`) |
| `sql_database_update` | Update database name or description |
| `sql_database_delete` | Delete a database |
| `sql_database_get_definition` | Get the public definition (dacpac/sqlproj, LRO). Writes files to `outputDirectoryPath` |
| `sql_database_update_definition` | Update the public definition (LRO). Reads from `partsDirectoryPath` or inline `parts` |
| `sql_database_list_restorable_deleted_databases` | List deleted databases still eligible for point-in-time restore |
| `sql_database_start_mirroring` | Start streaming database changes into OneLake as Delta tables |
| `sql_database_stop_mirroring` | Stop mirroring |

### KQL Queryset (7 tools)

Saved KQL query tabs associated with a KQL/Eventhouse database.

| Tool | Description |
|------|-------------|
| `kql_queryset_list` | List all KQL querysets in a workspace |
| `kql_queryset_get` | Get queryset details |
| `kql_queryset_create` | Create a new queryset (optionally seeded from `definitionDirectoryPath`) |
| `kql_queryset_update` | Update name or description |
| `kql_queryset_delete` | Delete a queryset |
| `kql_queryset_get_definition` | Get the definition (LRO). Writes files to `outputDirectoryPath` |
| `kql_queryset_update_definition` | Update the definition (LRO). Reads from `partsDirectoryPath` or inline `parts` |

### KQL Dashboard (7 tools)

Real-time visualization dashboards built on KQL/Eventhouse data — the Real-Time Intelligence equivalent of a Power BI Report.

| Tool | Description |
|------|-------------|
| `kql_dashboard_list` | List all KQL dashboards in a workspace |
| `kql_dashboard_get` | Get dashboard details |
| `kql_dashboard_create` | Create a new dashboard (optionally seeded from `definitionDirectoryPath`) |
| `kql_dashboard_update` | Update name or description |
| `kql_dashboard_delete` | Delete a dashboard |
| `kql_dashboard_get_definition` | Get the definition (LRO). Writes files to `outputDirectoryPath` |
| `kql_dashboard_update_definition` | Update the definition (LRO). Reads from `partsDirectoryPath` or inline `parts` |

## License

AGPL-3.0
