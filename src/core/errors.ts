export class FabricApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errorCode?: string,
    public relatedResource?: string,
    public requestId?: string,
    public errorDetails?: unknown[]
  ) {
    super(message);
    this.name = "FabricApiError";
  }
}

export function formatToolError(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  let message: string;
  if (error instanceof FabricApiError) {
    message = `Fabric API Error (${error.statusCode}): ${error.message}`;
    if (error.errorCode) message += `\nError code: ${error.errorCode}`;
    if (error.relatedResource) message += `\nRelated resource: ${error.relatedResource}`;
    if (error.requestId) message += `\nRequest ID: ${error.requestId}`;
    if (error.errorDetails && error.errorDetails.length > 0) {
      message += `\nDetails: ${JSON.stringify(error.errorDetails)}`;
    }
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
