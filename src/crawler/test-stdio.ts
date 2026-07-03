import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  console.error("[test] Connecting to filesystem MCP server...");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
  });

  const client = new Client({
    name: "kansei-test",
    version: "0.1.0",
  });

  await client.connect(transport);
  console.error("[test] ✓ Connected!");

  // Get server info
  const info = client.getServerVersion();
  console.error(`[test] Server: ${info?.name} v${info?.version}`);

  // List tools
  const tools = await client.listTools();
  console.error(`[test] Tools (${tools.tools.length}):`);
  for (const t of tools.tools) {
    console.error(`  - ${t.name}: ${(t.description || "").slice(0, 80)}`);
  }

  // Try a safe tool call
  console.error("[test] Calling list_directory...");
  const result = await client.callTool({
    name: "list_directory",
    arguments: { path: "." },
  });
  const text = (result.content as Array<{ type: string; text: string }>)[0]?.text || "";
  console.error(`[test] ✓ Result (first 300 chars): ${text.slice(0, 300)}`);

  await client.close();
  console.error("[test] Done.");
}

main().catch((err) => {
  console.error("[test] Fatal:", err.message);
  process.exit(1);
});
