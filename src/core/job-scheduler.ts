import { FabricClient } from "../client/fabric-client.js";
import type { JobInstance } from "./types.js";

export async function runOnDemandJob(
  client: FabricClient,
  workspaceId: string,
  itemId: string,
  jobType: string,
  executionData?: Record<string, unknown>
): Promise<JobInstance> {
  const body: Record<string, unknown> = {};
  if (executionData) {
    body.executionData = executionData;
  }
  const response = await client.post<JobInstance>(
    `/workspaces/${workspaceId}/items/${itemId}/jobs/instances?jobType=${jobType}`,
    Object.keys(body).length > 0 ? body : undefined
  );
  return response.data;
}

export async function getJobInstance(
  client: FabricClient,
  workspaceId: string,
  itemId: string,
  jobInstanceId: string
): Promise<JobInstance> {
  const response = await client.get<JobInstance>(
    `/workspaces/${workspaceId}/items/${itemId}/jobs/instances/${jobInstanceId}`
  );
  return response.data;
}

export async function cancelJobInstance(
  client: FabricClient,
  workspaceId: string,
  itemId: string,
  jobInstanceId: string
): Promise<void> {
  await client.post(
    `/workspaces/${workspaceId}/items/${itemId}/jobs/instances/${jobInstanceId}/cancel`
  );
}

export async function listJobInstances(
  client: FabricClient,
  workspaceId: string,
  itemId: string
): Promise<JobInstance[]> {
  const response = await client.get<{ value: JobInstance[] }>(
    `/workspaces/${workspaceId}/items/${itemId}/jobs/instances`
  );
  return response.data.value ?? [];
}
