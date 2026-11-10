#!/usr/bin/env node
/**
 * Onyx & Lynx MCP Server
 * ----------------------
 * Onyx  = business discovery (Google Places / Apple Maps / Yelp, resolved from a
 *         U.S. zip code or Google Plus Code / "global code", plus state-registry
 *         verification links and cross-source dedupe).
 * Lynx  = outreach (Resend email with CAN-SPAM guardrails + a file-backed
 *         suppression/CRM list so a business is never double-emailed or
 *         emailed after opting out).
 *
 * Part of the GANESH-Ai-BRAIN local-business outreach engine ("Sleepy Hollow").
 * See README.md before running against real API keys / sending real email.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { registerOnyxTools } from "./tools/onyx-search.js";
import { registerLynxTools } from "./tools/lynx-outreach.js";

const server = new McpServer({
  name: "onyx-lynx-mcp-server",
  version: "0.1.0",
});

registerOnyxTools(server);
registerLynxTools(server);

function warnMissingEnv(): void {
  const optional: Array<[string, string]> = [
    ["GOOGLE_MAPS_API_KEY", "onyx_resolve_location (zip) / onyx_search_google_places"],
    ["APPLE_TEAM_ID", "onyx_search_apple_maps"],
    ["APPLE_MAPKIT_KEY_ID", "onyx_search_apple_maps"],
    ["APPLE_MAPKIT_P8_PATH", "onyx_search_apple_maps"],
    ["YELP_API_KEY", "onyx_search_yelp"],
    ["RESEND_API_KEY", "lynx_send_outreach_email"],
  ];
  const missing = optional.filter(([envVar]) => !process.env[envVar]);
  if (missing.length) {
    console.error(
      "[onyx-lynx-mcp-server] Starting with missing env vars — the following tools will return " +
        "a clear setup error instead of running until you set them:\n" +
        missing.map(([envVar, tool]) => `  - ${envVar} (needed by ${tool})`).join("\n")
    );
  }
}

async function runStdio(): Promise<void> {
  warnMissingEnv();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[onyx-lynx-mcp-server] running via stdio");
}

async function runHTTP(): Promise<void> {
  warnMissingEnv();
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.error(`[onyx-lynx-mcp-server] running on http://localhost:${port}/mcp`);
  });
}

const transportMode = process.env.TRANSPORT || "stdio";
if (transportMode === "http") {
  runHTTP().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
