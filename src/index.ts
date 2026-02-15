#!/usr/bin/env node

import { createServer } from "./server.js";

const transport = process.env.TRANSPORT ?? "stdio";

async function startStdio() {
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const server = createServer();
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  console.error("MCP Fabric API server running on stdio");
}

async function startHttp() {
  const { default: express } = await import("express");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );
  const { randomUUID } = await import("node:crypto");
  const {
    getOAuthConfig,
    createOAuthMetadataHandler,
    createTokenValidationMiddleware,
  } = await import("./auth/oauth-handler.js");

  const config = getOAuthConfig();
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const app = express();

  app.use(express.json());

  // OAuth protected resource metadata
  app.get(
    "/.well-known/oauth-protected-resource",
    createOAuthMetadataHandler(config)
  );

  // Token validation middleware for MCP endpoint
  app.use("/mcp", createTokenValidationMiddleware(config));

  // Map to store transports by session ID
  const transports = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();

  // Handle MCP requests
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      const sessionTransport = transports.get(sessionId)!;
      await sessionTransport.handleRequest(req, res, req.body);
      return;
    }

    const sessionTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        transports.set(newSessionId, sessionTransport);
      },
    });

    sessionTransport.onclose = () => {
      const sid = sessionTransport.sessionId;
      if (sid) transports.delete(sid);
    };

    const server = createServer();
    await server.connect(sessionTransport);
    await sessionTransport.handleRequest(req, res, req.body);
  });

  // Handle SSE for server-to-client notifications
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const sessionTransport = transports.get(sessionId)!;
    await sessionTransport.handleRequest(req, res);
  });

  // Handle session deletion
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const sessionTransport = transports.get(sessionId)!;
    await sessionTransport.handleRequest(req, res);
  });

  app.listen(port, () => {
    console.error(`MCP Fabric API server running on http://localhost:${port}/mcp`);
  });
}

if (transport === "http") {
  startHttp().catch((error) => {
    console.error("Failed to start HTTP server:", error);
    process.exit(1);
  });
} else {
  startStdio().catch((error) => {
    console.error("Failed to start stdio server:", error);
    process.exit(1);
  });
}
