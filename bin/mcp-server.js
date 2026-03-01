#!/usr/bin/env node
/**
 * MCP server entry point.
 *
 * Launch this file directly with Node.js from an MCP host (Claude Desktop,
 * VS Code Copilot Chat, etc.) to start the copilot-insight MCP server over
 * standard input/output.
 *
 * Usage:
 *   node bin/mcp-server.js --storage /path/to/globalStorage
 *
 * The globalStorage path is the directory that contains the `events/`
 * sub-folder written by EventStorage.  In a normal VS Code installation it is
 * located at:
 *   <userData>/User/globalStorage/nitta-a.copilot-insight
 *
 * Alternatively set the COPILOT_INSIGHT_STORAGE_PATH environment variable.
 */

const { startMcpServer } = require("../dist/mcp-server.js");

const args = process.argv.slice(2);
const storageIdx = args.indexOf("--storage");
const storagePath =
  storageIdx >= 0 && args[storageIdx + 1]
    ? args[storageIdx + 1]
    : process.env["COPILOT_INSIGHT_STORAGE_PATH"] || "";

if (!storagePath) {
  console.error(
    "[copilot-insight MCP] No storage path provided.\n" +
      "Use --storage <path> or set COPILOT_INSIGHT_STORAGE_PATH.",
  );
  process.exit(1);
}

startMcpServer(storagePath).catch((err) => {
  console.error("[copilot-insight MCP] Fatal error:", err);
  process.exit(1);
});
