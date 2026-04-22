/**
 * Thrown when device-code authentication is required.
 * The message contains the URL and code the user must use to authenticate.
 * This is NOT an error — it signals the user needs to act before retrying.
 */
export class DeviceCodeAuthRequired extends Error {
  constructor(public deviceCodeMessage: string) {
    super(deviceCodeMessage);
    this.name = "DeviceCodeAuthRequired";
  }
}

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

export function formatToolError(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: boolean } {
  if (error instanceof DeviceCodeAuthRequired) {
    return {
      content: [{ type: "text", text: `🔐 Authentication required.\n\n${error.deviceCodeMessage}\n\nOnce you have completed the sign-in, retry the tool call.` }],
      isError: false,
    };
  }

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
