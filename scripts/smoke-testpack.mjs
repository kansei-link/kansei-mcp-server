import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(process.argv[2] || "exec-harness/taskpacks/freee/freee-accounting-t1-account-item-detail.v1.json");
const raw = readFileSync(path, "utf8");
const pack = JSON.parse(raw);
const fail = (message) => { throw new Error(message); };

for (const key of ["schema_version", "id", "version", "service_id", "task_type", "risk", "source_recipe", "scripted_steps", "agentic", "publication"]) {
  if (pack[key] == null) fail(`missing ${key}`);
}
if (!/^R[0-3]$/.test(pack.risk)) fail("invalid risk");
if (!Array.isArray(pack.scripted_steps) || pack.scripted_steps.length < 2) fail("insufficient scripted steps");
if (pack.risk === "R0") {
  const writes = pack.scripted_steps.filter((s) => /(?:post|put|patch|delete|create|update)/i.test(s.tool));
  if (writes.length) fail(`R0 pack contains write tool(s): ${writes.map((s) => s.tool).join(",")}`);
  if (pack.cleanup?.required) fail("R0 pack cannot require cleanup");
}
if (pack.publication.minimum_runs < 5 || !pack.publication.requires_assertion_verified) {
  fail("publication gate is weaker than Data Architecture v1.1");
}

const captures = new Set();
for (const step of pack.scripted_steps) {
  const serialized = JSON.stringify(step.arguments || {});
  for (const match of serialized.matchAll(/\{\{([^}]+)\}\}/g)) {
    if (!captures.has(match[1])) fail(`template ${match[1]} used before capture`);
  }
  for (const key of Object.keys(step.capture || {})) captures.add(key);
}

console.log(JSON.stringify({
  result: "PASS",
  id: pack.id,
  risk: pack.risk,
  steps: pack.scripted_steps.length,
  sha256: createHash("sha256").update(raw).digest("hex"),
}));
