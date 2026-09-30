/**
 * Test-only preload (see smoke-loopback-ports.mjs): requests of a harness child for the fixture seals' loopback
 * ports (127.0.0.1:47331 / :47332) go to the ports chosen with KANSEI_SMOKE_PORT_A / KANSEI_SMOKE_PORT_B.
 * Only loopback, only those two ports, only when the variables are set. Never loaded outside the smoke tests.
 */
const map = new Map();
if (process.env.KANSEI_SMOKE_PORT_A) map.set('47331', String(process.env.KANSEI_SMOKE_PORT_A));
if (process.env.KANSEI_SMOKE_PORT_B) map.set('47332', String(process.env.KANSEI_SMOKE_PORT_B));
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (typeof input === 'string' || input instanceof URL) {
    const url = new URL(String(input));
    if (url.hostname === '127.0.0.1' && map.has(url.port)) { url.port = map.get(url.port); return realFetch(url.href, init); }
  }
  return realFetch(input, init);
};
