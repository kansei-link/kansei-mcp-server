// ---------------------------------------------------------------------------
// Secret masking for agent-submitted symptom / task text (Agent Stars ask).
//
// Agents paste raw error output. That output routinely carries bearer tokens,
// API keys, tenant subdomains, e-mails and request ids. DESIGN §3-4 says the
// anti-abuse layer is "speed and duplicates" plus "automatic masking of
// secrets (keys, ids, URL tokens)". This pass runs BEFORE anything is stored
// and before similarity matching, so raw unmasked text never reaches SQLite.
//
// Order matters: wide patterns (Authorization headers, URLs) run first so
// that a token inside a URL is not partially matched by a narrower rule.
// This complements pii-masker.ts (names/phones) — it does not replace it.
// ---------------------------------------------------------------------------

const patterns: Array<{ kind: string; regex: RegExp; replacement: string | ((m: string, ...g: string[]) => string) }> = [
  // Authorization: Bearer xxxxx / "Bearer xxxxx" / Basic xxxxx
  // Case-insensitive: "bearer xxx" in lower case is as much a credential as "Bearer xxx" (Codex review 2026-10-21).
  { kind: "BEARER", regex: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9\-._~+/=]{8,}/gi, replacement: "$1 [TOKEN]" },
  // Known key prefixes: OpenAI sk-, GitHub ghp_/gho_/ghu_/ghs_/ghr_/github_pat_, Slack xox[abpr]-, Stripe sk_live/pk_live/rk_, AWS AKIA, Anthropic sk-ant-
  {
    kind: "API_KEY",
    regex: /\b(?:sk-ant-[A-Za-z0-9\-_]{8,}|sk-[A-Za-z0-9\-_]{8,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[abprs]-[A-Za-z0-9\-]{8,}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|AKIA[A-Z0-9]{12,}|AIza[A-Za-z0-9\-_]{20,})/g,
    replacement: "[API_KEY]",
  },
  // key=value style secrets in query strings / logs: token=..., api_key=..., access_token=..., secret=..., password=...
  {
    kind: "KV_SECRET",
    // Also JSON / quoted keys: "access_token": "...", 'token':'...' (the key's closing quote may precede ":").
    // A quoted value is masked up to its closing quote, spaces included ("password":"a b c d" →
    // "password":"[SECRET]"); an unquoted value is masked as one run of token characters.
    regex: /\b(access_token|refresh_token|id_token|api[_-]?key|apikey|client_secret|secret|password|passwd|token|signature|sig)(["']?\s*[=:]\s*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|[A-Za-z0-9\-._~+/%]{6,})/gi,
    replacement: (_m: string, key: string, sep: string, dq?: string, sq?: string) =>
      dq !== undefined ? `${key}${sep}"[SECRET]"` : sq !== undefined ? `${key}${sep}'[SECRET]'` : `${key}${sep}[SECRET]`,
  },
  // Emails
  { kind: "EMAIL", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL]" },
  // URLs: keep scheme + host only; collapse a tenant-looking subdomain (acme.slack.com → [tenant].slack.com)
  {
    kind: "URL",
    regex: /\bhttps?:\/\/([^\s/?#"'<>)]+)[^\s"'<>)]*/gi,
    replacement: (_m: string, host: string) => `https://${collapseTenantHost(host.toLowerCase())}`,
  },
  // UUIDs (request ids, installation ids, tenant ids)
  { kind: "UUID", regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, replacement: "[UUID]" },
  // JWT-ish: three base64url segments separated by dots
  { kind: "JWT", regex: /\b[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\b/g, replacement: "[JWT]" },
  // Long hex blobs (32+): hashes, session ids, raw keys
  { kind: "HEX", regex: /\b[0-9a-f]{32,}\b/gi, replacement: "[HEX]" },
  // Long opaque base64/alnum blobs (40+ chars, no spaces) — catches keys without known prefix
  { kind: "BLOB", regex: /\b[A-Za-z0-9+/=_\-]{40,}\b/g, replacement: "[BLOB]" },
];

// Hosts whose first label is a customer tenant. Anything *.<known-saas-host>
// keeps only the SaaS host; for unknown hosts with 3+ labels we also drop the
// first label when it is not a generic one (www/api/app/docs...), because a
// tenant slug is itself an identifier of the user's organisation.
const TENANT_HOSTS = [
  "slack.com", "atlassian.net", "kintone.com", "cybozu.com", "zendesk.com", "freshdesk.com",
  "myshopify.com", "salesforce.com", "my.salesforce.com", "lightning.force.com", "okta.com",
  "auth0.com", "hubspot.com", "notion.site", "sharepoint.com", "onmicrosoft.com", "zoom.us",
  "monday.com", "asana.com", "intercom.io", "chatwork.com", "smarthr.jp", "secure.freee.co.jp",
  "backlog.com", "backlog.jp", "box.com", "github.io", "supabase.co", "vercel.app", "railway.app",
  "herokuapp.com", "workers.dev", "pages.dev",
];
const GENERIC_LABELS = new Set(["www", "api", "app", "docs", "developer", "developers", "accounts", "login", "auth", "secure", "status", "help", "support", "cdn", "mail"]);

export function collapseTenantHost(host: string): string {
  const h = host.replace(/:\d+$/, "");
  for (const base of TENANT_HOSTS) {
    if (h.endsWith("." + base) && h.length > base.length + 1) return `[tenant].${base}`;
  }
  const labels = h.split(".");
  if (labels.length >= 3 && !GENERIC_LABELS.has(labels[0]) && !/^\d+$/.test(labels[0])) {
    return `[tenant].${labels.slice(1).join(".")}`;
  }
  return h;
}

export interface MaskResult {
  masked: string;
  maskedKinds: string[];
}

/** Mask tokens/keys/emails/ids/URL paths. Idempotent: masking masked text is a no-op. */
export function maskSecrets(text: string | null | undefined): MaskResult {
  if (!text) return { masked: "", maskedKinds: [] };
  let result = String(text);
  const kinds: string[] = [];
  for (const { kind, regex, replacement } of patterns) {
    regex.lastIndex = 0;
    if (!regex.test(result)) continue;
    regex.lastIndex = 0;
    kinds.push(kind);
    result = typeof replacement === "string"
      ? result.replace(regex, replacement)
      : result.replace(regex, replacement as (substring: string, ...args: any[]) => string);
  }
  return { masked: result, maskedKinds: kinds };
}
