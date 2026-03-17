import { Connection, Request } from "tedious";
import { TokenManager } from "../auth/token-manager.js";
import { logger } from "../utils/logger.js";
import type { SqlQueryResult } from "../core/types.js";

const DEFAULT_MAX_ROWS = 1000;
const QUERY_TIMEOUT_MS = 30000;
const COMPONENT = "SqlClient";

export class SqlClient {
  constructor(private tokenManager: TokenManager) {}

  async executeQuery(
    server: string,
    database: string,
    query: string,
    maxRows: number = DEFAULT_MAX_ROWS
  ): Promise<SqlQueryResult> {
    const token = await this.tokenManager.getDatabaseToken();

    logger.debug(COMPONENT, `Connecting to ${server}`, { database, maxRows });
    const startTime = Date.now();

    return new Promise<SqlQueryResult>((resolve, reject) => {
      const columns: string[] = [];
      const rows: Record<string, unknown>[] = [];

      const connection = new Connection({
        server,
        authentication: {
          type: "azure-active-directory-access-token",
          options: {
            token,
          },
        },
        options: {
          database,
          encrypt: true,
          port: 1433,
          requestTimeout: QUERY_TIMEOUT_MS,
          trustServerCertificate: false,
        },
      });

      connection.on("connect", (err) => {
        if (err) {
          const durationMs = Date.now() - startTime;
          logger.error(COMPONENT, `Connection failed to ${server}`, { database, durationMs, error: err.message });
          reject(new Error(`SQL connection failed: ${err.message}`));
          return;
        }

        logger.debug(COMPONENT, `Connected to ${server}`, { database, durationMs: Date.now() - startTime });

        const request = new Request(query, (reqErr, rowCount) => {
          const durationMs = Date.now() - startTime;
          connection.close();
          if (reqErr) {
            logger.error(COMPONENT, `Query failed on ${server}`, { database, durationMs, error: reqErr.message });
            reject(new Error(`SQL query failed: ${reqErr.message}`));
            return;
          }
          logger.debug(COMPONENT, `Query completed on ${server}`, {
            database,
            durationMs,
            columnCount: columns.length,
            rowCount: rowCount ?? rows.length,
          });
          resolve({ columns, rows, rowCount: rowCount ?? rows.length });
        });

        request.on("columnMetadata", (columnMetadata) => {
          const cols = Array.isArray(columnMetadata)
            ? columnMetadata
            : Object.values(columnMetadata);
          for (const col of cols) {
            columns.push(col.colName);
          }
        });

        request.on("row", (rowColumns: any) => {
          if (rows.length >= maxRows) return;
          const row: Record<string, unknown> = {};
          const cols = Array.isArray(rowColumns)
            ? rowColumns
            : Object.values(rowColumns);
          for (const col of cols) {
            row[col.metadata.colName] = col.value;
          }
          rows.push(row);
        });

        connection.execSql(request);
      });

      connection.on("error", (err) => {
        logger.error(COMPONENT, `Connection error on ${server}`, { database, error: err.message });
        reject(new Error(`SQL connection error: ${err.message}`));
      });

      connection.connect();
    });
  }
}
