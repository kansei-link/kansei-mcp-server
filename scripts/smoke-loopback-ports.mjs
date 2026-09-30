/**
 * Loopback ports of the marker smoke tests.
 *
 * The M-996 and M-995 fixture seals name 127.0.0.1:47331 and 127.0.0.1:47332, and their sha256 is committed, so
 * the seals cannot name another port. When those ports are taken on a machine (Codex review of 544808b: EADDRINUSE),
 * set
 *
 *   KANSEI_SMOKE_PORT_A   instead of 47331 (http-probe, optional-parts)
 *   KANSEI_SMOKE_PORT_B   instead of 47332 (fetch-check, optional-parts)
 *
 * The smoke's own servers then listen on the chosen ports, and the harness children are started with a preload
 * (smoke-loopback-preload.mjs) that sends their requests for 127.0.0.1:47331 / :47332 to the chosen ports.
 * Transport only: seals, taskpacks, checks and attestation targets still say 47331 / 47332.
 * Default (variables unset): the fixture ports, no preload, nothing changes.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FIXTURE_PORT_A = 47331;
export const FIXTURE_PORT_B = 47332;

const chosen = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`smoke port must be an integer 1..65535 (got ${JSON.stringify(value)})`);
  return n;
};

/** { A, B, remapped, childEnv } — childEnv is merged into the environment of every harness child. */
export function smokePorts(env = process.env) {
  const A = chosen(env.KANSEI_SMOKE_PORT_A, FIXTURE_PORT_A);
  const B = chosen(env.KANSEI_SMOKE_PORT_B, FIXTURE_PORT_B);
  const remapped = A !== FIXTURE_PORT_A || B !== FIXTURE_PORT_B;
  const preload = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'smoke-loopback-preload.mjs')).href;
  const childEnv = remapped ? { NODE_OPTIONS: `${env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : ''}--import=${preload}`, KANSEI_SMOKE_PORT_A: String(A), KANSEI_SMOKE_PORT_B: String(B) } : {};
  return { A, B, remapped, childEnv };
}
