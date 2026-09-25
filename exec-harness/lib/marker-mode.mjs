import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './marker-bundle.mjs';

/** Test machinery must never use the persistent marker DB/report writer. */
export function testOnlyReasons({ args, env, executor, pack, packPath, sealedPath, commitmentPath, fixturesDir }) {
  const reasons = [];
  if (args.includes('--mcp')) reasons.push('mcp_flag');
  if (Object.hasOwn(env, 'KANSEI_MCP_COMMAND')) reasons.push('mcp_environment');
  if (executor !== 'agent') reasons.push('executor');
  const isFixturePath = (path) => {
    if (!path) return false;
    const real = existsSync(path) ? realpathSync(path) : path;
    return /(^|[\\/])fixtures([\\/]|$)/i.test(real);
  };
  if ([packPath, sealedPath, commitmentPath].some(isFixturePath) || /fixture/i.test(`${pack.id} ${pack.marker?.claim}`)) reasons.push('fixture');
  // Generic kinds: a fake LLM provider or environment-substituted endpoints are test machinery too.
  if ((pack.marker?.providers || []).includes('fake') || Object.hasOwn(env, 'KANSEI_FAKE_LLM_ANSWERS_FILE')) reasons.push('fake_provider');
  if (/\$\{ENV:/.test(JSON.stringify(pack.marker || {}))) reasons.push('env_substitution');
  // A copied fixture seal is still a fixture, regardless of its new filename.
  const fixtureDigests = new Set(readdirSync(fixturesDir).filter((f) => f.endsWith('.sealed.json')).map((f) => sha256(readFileSync(join(fixturesDir, f)))));
  if (fixtureDigests.has(pack.marker?.expected_digest) || (sealedPath && existsSync(sealedPath) && fixtureDigests.has(sha256(readFileSync(sealedPath))))) reasons.push('fixture_digest');
  return reasons;
}
