import { type Request, type Response, type NextFunction } from "express";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

export interface AuthenticatedRequest extends Request {
  userToken?: string;
}

function getOAuthConfig(): OAuthConfig {
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const tenantId = process.env.AZURE_TENANT_ID;

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error(
      "HTTP mode requires AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and AZURE_TENANT_ID environment variables"
    );
  }

  return { clientId, clientSecret, tenantId };
}

export function createOAuthMetadataHandler(config: OAuthConfig) {
  return (_req: Request, res: Response) => {
    res.json({
      resource: process.env.AZURE_CLIENT_ID,
      authorization_servers: [
        `https://login.microsoftonline.com/${config.tenantId}/v2.0`
      ],
    });
  };
}

export function createTokenValidationMiddleware(config: OAuthConfig) {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      next();
      return;
    }
    req.userToken = authHeader.slice(7);
    next();
  };
}

export { getOAuthConfig };
