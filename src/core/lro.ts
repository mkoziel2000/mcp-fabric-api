import { FabricClient } from "../client/fabric-client.js";
import { FabricApiError } from "./errors.js";
import type { OperationState } from "./types.js";

export interface LroOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL = 2000;
const DEFAULT_TIMEOUT = 300000; // 5 minutes

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollOperation(
  client: FabricClient,
  operationId: string,
  options?: LroOptions
): Promise<OperationState> {
  const pollInterval = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT;
  const start = Date.now();

  while (true) {
    const response = await client.get<OperationState>(`/operations/${operationId}`);
    const state = response.data;

    if (state.status === "Succeeded" || state.status === "Failed" || state.status === "Cancelled") {
      if (state.status === "Failed") {
        throw new FabricApiError(
          state.error?.message ?? "Operation failed",
          500,
          state.error?.errorCode
        );
      }
      return state;
    }

    if (Date.now() - start > timeout) {
      throw new FabricApiError(
        `Operation ${operationId} timed out after ${timeout / 1000}s`,
        408,
        "OperationTimeout"
      );
    }

    await sleep(pollInterval);
  }
}

export async function getOperationResult<T>(
  client: FabricClient,
  operationId: string
): Promise<T | undefined> {
  try {
    const response = await client.get<T>(`/operations/${operationId}/result`);
    return response.data;
  } catch {
    return undefined;
  }
}
