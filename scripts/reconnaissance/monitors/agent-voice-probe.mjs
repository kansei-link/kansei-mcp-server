/**
 * Agent voice probe — sends queries to product APIs and verifies the
 * response matches expected patterns from feature specs.
 *
 * Designed for two use cases:
 *
 * 1. **Chat-style probing**: send natural-language queries to chat
 *    endpoints (e.g. ScaNavi sake recommendation) and assert the
 *    response shape matches the spec in `docs/specs/{feature}.md` —
 *    e.g. recommendation must contain disclaimer text, brand list, etc.
 *
 * 2. **API contract probing**: send canonical queries to public API
 *    endpoints (e.g. KanseiLink dashboard) and assert response JSON
 *    has expected fields with non-empty values. Catches schema
 *    regressions that health (urls_must_200) cannot detect.
 *
 * Config schema:
 *
 *   "agent_voice_probe": {
 *     "enabled": true,
 *     "probes": [
 *       {
 *         "name": "dashboard freshness reports services_total > 0",
 *         "request": {
 *           "method": "GET",
 *           "url": "https://...",
 *           "headers": { ... },
 *           "body": "..." (string or JSON-serializable)
 *         },
 *         "expectations": {
 *           "status": 200,                          // optional, default 2xx
 *           "json_paths": [                          // optional, applied if response is JSON
 *             { "path": "services_total", "type": "number", "min": 1 },
 *             { "path": "[0].id", "type": "string" }
 *           ],
 *           "substrings": ["expected text"]          // optional, applied to body
 *         },
 *         "spec_ref": "docs/specs/dashboard-freshness.md"  // optional
 *       }
 *     ],
 *     "timeout_ms": 15000
 *   }
 *
 * Returns findings (one per probe). Each finding:
 *   {
 *     probe_name, url, status, response_time_ms,
 *     ok, urgency, reason, error?
 *   }
 */

const DEFAULT_TIMEOUT_MS = 15000;

export async function runAgentVoiceProbe(config) {
  const monitor = config.monitors?.agent_voice_probe;
  if (!monitor || !monitor.enabled) {
    return [];
  }

  const probes = monitor.probes || [];
  const timeoutMs = monitor.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  const findings = [];
  for (const probe of probes) {
    const finding = await runOneProbe(probe, timeoutMs);
    findings.push(finding);
  }

  return findings;
}

async function runOneProbe(probe, timeoutMs) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  const url = probe.request?.url;
  if (!url) {
    return {
      probe_name: probe.name || "(unnamed)",
      url: null,
      status: null,
      response_time_ms: 0,
      ok: false,
      urgency: "critical",
      reason: "probe config missing request.url",
      error: "missing_url",
    };
  }

  const method = (probe.request?.method || "GET").toUpperCase();
  const headers = probe.request?.headers || {};
  let body = probe.request?.body;
  if (body && typeof body !== "string") body = JSON.stringify(body);
  if (body && !headers["content-type"] && !headers["Content-Type"]) {
    headers["content-type"] = "application/json";
  }

  let response;
  let responseText = "";
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...headers,
        "user-agent":
          "kansei-link-reconnaissance-ant/0.3 (+https://github.com/michielinksee/synapse-arrows-playbook)",
      },
      body: method === "GET" || method === "HEAD" ? undefined : body,
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeoutHandle);
    responseText = await response.text();
  } catch (error) {
    clearTimeout(timeoutHandle);
    return {
      probe_name: probe.name || "(unnamed)",
      url,
      status: null,
      response_time_ms: Date.now() - startedAt,
      ok: false,
      urgency: "critical",
      reason:
        error.name === "AbortError"
          ? `timeout after ${timeoutMs}ms`
          : `network error: ${error.message}`,
      error: error.message,
    };
  }

  const elapsed = Date.now() - startedAt;
  const expectations = probe.expectations || {};
  const failures = [];

  // 1. Status check
  const expectedStatus = expectations.status;
  if (expectedStatus != null) {
    if (response.status !== expectedStatus) {
      failures.push(`status ${response.status} (expected ${expectedStatus})`);
    }
  } else {
    if (response.status < 200 || response.status >= 300) {
      failures.push(`status ${response.status} (expected 2xx)`);
    }
  }

  // 2. JSON path checks
  let parsedJson = null;
  if (expectations.json_paths && expectations.json_paths.length > 0) {
    try {
      parsedJson = JSON.parse(responseText);
    } catch {
      failures.push("response body is not valid JSON (json_paths require JSON)");
    }
    if (parsedJson !== null) {
      for (const check of expectations.json_paths) {
        const result = checkJsonPath(parsedJson, check);
        if (!result.ok) failures.push(`json_path ${check.path}: ${result.reason}`);
      }
    }
  }

  // 3. Substring checks
  if (expectations.substrings && expectations.substrings.length > 0) {
    for (const sub of expectations.substrings) {
      if (!responseText.includes(sub)) {
        failures.push(`response missing substring "${sub}"`);
      }
    }
  }

  if (failures.length === 0) {
    return {
      probe_name: probe.name,
      url,
      status: response.status,
      response_time_ms: elapsed,
      ok: true,
      urgency: "info",
      reason: `passed all checks (${elapsed}ms)`,
    };
  }

  // Classify: status mismatch alone = critical, expectations missing = warning
  const hasStatusMismatch = failures.some((f) => f.startsWith("status "));
  const urgency = hasStatusMismatch ? "critical" : "warning";

  return {
    probe_name: probe.name,
    url,
    status: response.status,
    response_time_ms: elapsed,
    ok: false,
    urgency,
    reason: failures.join("; "),
  };
}

/**
 * Resolve a json_path like "services_total" or "data[0].id" or "[0].name".
 * Returns { ok, reason }.
 */
function checkJsonPath(obj, check) {
  const value = resolvePath(obj, check.path);
  if (value === undefined) {
    return { ok: false, reason: "path missing" };
  }

  if (check.type) {
    const actualType = Array.isArray(value) ? "array" : typeof value;
    if (actualType !== check.type) {
      return { ok: false, reason: `type ${actualType} (expected ${check.type})` };
    }
  }

  if (check.min != null) {
    if (typeof value === "number" && value < check.min) {
      return { ok: false, reason: `value ${value} < min ${check.min}` };
    }
    if (Array.isArray(value) && value.length < check.min) {
      return { ok: false, reason: `array length ${value.length} < min ${check.min}` };
    }
    if (typeof value === "string" && value.length < check.min) {
      return { ok: false, reason: `string length ${value.length} < min ${check.min}` };
    }
  }

  if (check.max != null) {
    if (typeof value === "number" && value > check.max) {
      return { ok: false, reason: `value ${value} > max ${check.max}` };
    }
    if (Array.isArray(value) && value.length > check.max) {
      return { ok: false, reason: `array length ${value.length} > max ${check.max}` };
    }
  }

  if (check.equals !== undefined) {
    if (value !== check.equals) {
      return { ok: false, reason: `value ${JSON.stringify(value)} != ${JSON.stringify(check.equals)}` };
    }
  }

  if (check.contains) {
    if (typeof value !== "string" || !value.includes(check.contains)) {
      return { ok: false, reason: `value does not contain "${check.contains}"` };
    }
  }

  return { ok: true };
}

/**
 * Resolve "a.b[0].c" style paths.
 */
function resolvePath(obj, pathStr) {
  const tokens = parsePath(pathStr);
  let current = obj;
  for (const tok of tokens) {
    if (current == null) return undefined;
    if (tok.type === "key") {
      current = current[tok.value];
    } else if (tok.type === "index") {
      current = current[tok.value];
    }
  }
  return current;
}

function parsePath(pathStr) {
  const tokens = [];
  // Handle leading [n]
  let i = 0;
  let buf = "";
  while (i < pathStr.length) {
    const ch = pathStr[i];
    if (ch === "[") {
      if (buf) {
        tokens.push({ type: "key", value: buf });
        buf = "";
      }
      const close = pathStr.indexOf("]", i);
      if (close === -1) break;
      const idx = Number(pathStr.slice(i + 1, close));
      tokens.push({ type: "index", value: idx });
      i = close + 1;
      if (pathStr[i] === ".") i += 1;
    } else if (ch === ".") {
      if (buf) {
        tokens.push({ type: "key", value: buf });
        buf = "";
      }
      i += 1;
    } else {
      buf += ch;
      i += 1;
    }
  }
  if (buf) tokens.push({ type: "key", value: buf });
  return tokens;
}
