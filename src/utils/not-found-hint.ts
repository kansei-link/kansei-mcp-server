/**
 * What `lookup` answers when a service id is not in the local database.
 *
 * Disclosure stage 1 (2026-10-23): an npm install carries the public copy of the catalogue, so a
 * miss is not only a typo any more — it may simply be something this installation does not have.
 * Instead of a bare error, point to the public card and to `ask`. No new route is involved: the
 * site and the hosted ask endpoint already exist. The `error` field keeps the same first sentence.
 */
const PUBLIC_BASE = "https://kansei-link.com";
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function notFoundHint(serviceId: string): { error: string; see?: string; ask?: string; hint: string } {
  const id = String(serviceId ?? "").trim();
  const safe = ID_RE.test(id) ? id : null;
  return {
    error: `Service '${id}' not found. Use search_services to find valid service IDs.`,
    ...(safe ? { see: `${PUBLIC_BASE}/services/${safe}/` } : {}),
    ask: `${PUBLIC_BASE}/api/v1/ask?service=<id>&error=<text>`,
    hint: safe
      ? `This installation holds the public copy of the catalogue. If '${safe}' exists, its card is at ${PUBLIC_BASE}/services/${safe}/ ; for an error you hit, ask with the exact text at ${PUBLIC_BASE}/api/v1/ask (GET, error ≤ 300 chars).`
      : `Service ids are lowercase letters, digits, '.', '_' and '-'. Use search_services, or look at ${PUBLIC_BASE}/services/.`,
  };
}
