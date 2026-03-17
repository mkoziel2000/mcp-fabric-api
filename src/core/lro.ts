import { FabricClient } from "../client/fabric-client.js";
import { FabricApiError } from "./errors.js";
import { logger } from "../utils/logger.js";
import type { OperationState } from "./types.js";

export interface LroOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL = 2000;
const DEFAULT_TIMEOUT = 300000; // 5 minutes
const COMPONENT = "LRO";

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
  let pollCount = 0;

  logger.debug(COMPONENT, `Polling started for operation ${operationId}`, {
    pollIntervalMs: pollInterval,
    timeoutMs: timeout,
  });

  while (true) {
    pollCount++;
    const response = await client.get<OperationState>(`/operations/${operationId}`);
    const state = response.data;

    logger.debug(COMPONENT, `Poll #${pollCount} for ${operationId}`, {
      status: state.status,
      elapsedMs: Date.now() - start,
    });

    if (state.status === "Succeeded" || state.status === "Failed" || state.status === "Cancelled") {
      if (state.status === "Failed") {
        logger.error(COMPONENT, `Operation ${operationId} failed`, {
          errorMessage: state.error?.message,
          errorCode: state.error?.errorCode,
          totalPolls: pollCount,
          totalMs: Date.now() - start,
        });
        throw new FabricApiError(
          state.error?.message ?? "Operation failed",
          500,
          state.error?.errorCode
        );
      }
      logger.debug(COMPONENT, `Operation ${operationId} completed`, {
        status: state.status,
        totalPolls: pollCount,
        totalMs: Date.now() - start,
      });
      return state;
    }

    if (Date.now() - start > timeout) {
      logger.error(COMPONENT, `Operation ${operationId} timed out`, {
        totalPolls: pollCount,
        totalMs: Date.now() - start,
      });
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
    logger.debug(COMPONENT, `Fetching result for operation ${operationId}`);
    const response = await client.get<T>(`/operations/${operationId}/result`);
    return response.data;
  } catch {
    logger.debug(COMPONENT, `No result available for operation ${operationId}`);
    return undefined;
  }
}
