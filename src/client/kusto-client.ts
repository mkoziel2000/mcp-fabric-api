import { TokenManager } from "../auth/token-manager.js";
import type { KqlQueryResult } from "../core/types.js";

const DEFAULT_MAX_ROWS = 1000;

interface KustoV2Frame {
  FrameType: string;
  TableKind?: string;
  Columns?: { ColumnName: string; ColumnType: string }[];
  Rows?: unknown[][];
}

export class KustoClient {
  constructor(private tokenManager: TokenManager) {}

  async executeQuery(
    queryServiceUri: string,
    database: string,
    kql: string,
    maxRows: number = DEFAULT_MAX_ROWS
  ): Promise<KqlQueryResult> {
    const token = await this.tokenManager.getKustoToken();

    const url = `${queryServiceUri.replace(/\/+$/, "")}/v2/rest/query`;
    const body = {
      db: database,
      csl: kql,
      properties: {
        Options: {
          servertimeout: "00:00:30",
          truncationmaxrecords: maxRows,
        },
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorDetail: string;
      try {
        const errorBody = await response.json();
        errorDetail = (errorBody as Record<string, unknown>)?.error
          ? JSON.stringify((errorBody as Record<string, unknown>).error)
          : JSON.stringify(errorBody);
      } catch {
        errorDetail = await response.text();
      }
      throw new Error(`KQL query failed (HTTP ${response.status}): ${errorDetail}`);
    }

    const frames = (await response.json()) as KustoV2Frame[];

    const primaryResult = frames.find(
      (f) => f.FrameType === "DataTable" && f.TableKind === "PrimaryResult"
    );

    if (!primaryResult) {
      throw new Error("KQL response did not contain a PrimaryResult table");
    }

    const columns = (primaryResult.Columns ?? []).map((c) => c.ColumnName);
    const rawRows = primaryResult.Rows ?? [];
    const cappedRows = rawRows.slice(0, maxRows);

    const rows: Record<string, unknown>[] = cappedRows.map((row) => {
      const record: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) {
        record[columns[i]] = row[i];
      }
      return record;
    });

    return { columns, rows, rowCount: rows.length };
  }
}
