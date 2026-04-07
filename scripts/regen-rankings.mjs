#!/usr/bin/env node
/**
 * Regenerate AEO ranking data for the public website.
 * Outputs: public/aeo-data.json and public/rankings-raw.json
 */
import { createServer } from "../dist/server.js";

const server = createServer();

// Use the MCP tool directly via the server's internal method
// We need to call the tool through the server's request handler
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

await server.connect(serverTransport);

const client = new Client({ name: "regen-script", version: "1.0" });
await client.connect(clientTransport);

// Generate JSON format
const jsonResult = await client.callTool({
  name: "generate_aeo_article",
  arguments: { quarter: "Q2 2026", format: "json", top_n: 30 },
});

const jsonText = jsonResult.content[0].text;
const jsonData = JSON.parse(jsonText);

// Write files
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "../public");

writeFileSync(resolve(publicDir, "aeo-data.json"), JSON.stringify(jsonData, null, 2));
writeFileSync(resolve(publicDir, "rankings-raw.json"), jsonText);

console.log(`Generated rankings for ${jsonData.meta.total_services_evaluated} services`);
console.log(`Grade distribution:`, jsonData.summary.grade_distribution);
console.log(`Agent readiness:`, jsonData.summary.agent_readiness);
console.log(`Top 5:`);
for (const s of jsonData.overall_top.slice(0, 5)) {
  console.log(`  ${s.rank}. ${s.name} — ${s.grade} (${s.aeo_score})`);
}

await client.close();
await server.close();
process.exit(0);
