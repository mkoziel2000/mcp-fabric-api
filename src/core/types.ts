export interface FabricItem {
  id: string;
  displayName: string;
  description?: string;
  type: string;
  workspaceId: string;
}

export interface ItemDefinitionPart {
  path: string;
  payload: string;
  payloadType: string;
}

export interface ItemDefinition {
  definition: {
    parts: ItemDefinitionPart[];
  };
}

export interface OperationState {
  id: string;
  status: "NotStarted" | "Running" | "Succeeded" | "Failed" | "Cancelled" | "Undefined";
  createdTimeUtc?: string;
  lastUpdatedTimeUtc?: string;
  error?: {
    errorCode: string;
    message: string;
  };
  percentComplete?: number;
}

export interface JobInstance {
  id: string;
  itemId: string;
  jobType: string;
  invokeType: string;
  status: "NotStarted" | "InProgress" | "Completed" | "Failed" | "Cancelled" | "Deduped";
  startTimeUtc?: string;
  endTimeUtc?: string;
  failureReason?: {
    message: string;
    errorCode: string;
  };
}

export interface PaginatedResponse<T> {
  value: T[];
  continuationUri?: string | null;
  continuationToken?: string | null;
}

export interface Workspace {
  id: string;
  displayName: string;
  description?: string;
  type: string;
  capacityId?: string;
  capacityAssignmentProgress?: string;
}

export interface LakehouseProperties {
  oneLakeTablesPath?: string;
  oneLakeFilesPath?: string;
  sqlEndpointProperties?: {
    id: string;
    connectionString: string;
    provisioningStatus: string;
  };
}

export interface Lakehouse extends FabricItem {
  properties?: LakehouseProperties;
}

export interface LakehouseTable {
  name: string;
  type: string;
  location: string;
  format: string;
}

export interface ScheduleConfig {
  id?: string;
  enabled: boolean;
  configuration: {
    type: string;
    startDateTime: string;
    endDateTime?: string;
    localTimeZoneId?: string;
    times?: string[];
    interval?: number;
    weekDays?: string[];
  };
}
