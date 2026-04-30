/**
 * Health monitor — pings each URL in config and classifies the result.
 *
 * Returns an array of findings. Each finding:
 *   {
 *     url: string,
 *     status: number | null,
 *     response_time_ms: number,
 *     ok: boolean,
 *     urgency: "critical" | "warning" | "info",
 *     reason: string,
 *     error?: string,
 *   }
 */

const DEFAULT_TIMEOUT_MS = 10000;
const SLOW_RESPONSE_MS = 3000;

export async function runHealthMonitor(config) {
  const monitor = config.monitors?.health;
  if (!monitor || !monitor.enabled) {
    return [];
  }

  const expectedStatus = monitor.expected_status ?? 200;
  const timeoutMs = monitor.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const failOpen = monitor.fail_open === true;

  const findings = [];

  for (const url of monitor.urls) {
    const finding = await probeUrl(url, expectedStatus, timeoutMs, failOpen);
    findings.push(finding);
  }

  return findings;
}

async function probeUrl(url, expectedStatus, timeoutMs, failOpen) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "kansei-link-reconnaissance-ant/0.1 (+https://github.com/michielinksee/synapse-arrows-playbook)",
      },
    });
    clearTimeout(timeoutHandle);

    const elapsed = Date.now() - startedAt;
    const status = response.status;
    const ok = status >= 200 && status < 300;

    if (ok) {
      return {
        url,
        status,
        response_time_ms: elapsed,
        ok: true,
        urgency: elapsed > SLOW_RESPONSE_MS ? "warning" : "info",
        reason:
          elapsed > SLOW_RESPONSE_MS
            ? `slow response (${elapsed}ms > ${SLOW_RESPONSE_MS}ms)`
            : `healthy (${elapsed}ms)`,
      };
    }

    // Non-2xx: critical OR warning depending on fail_open
    return {
      url,
      status,
      response_time_ms: elapsed,
      ok: false,
      urgency: failOpen ? "warning" : "critical",
      reason: `unexpected status ${status} (expected ${expectedStatus})${failOpen ? " — fail_open=true so warning" : ""}`,
    };
  } catch (error) {
    clearTimeout(timeoutHandle);
    const elapsed = Date.now() - startedAt;

    if (error.name === "AbortError") {
      return {
        url,
        status: null,
        response_time_ms: elapsed,
        ok: false,
        urgency: failOpen ? "warning" : "critical",
        reason: `timeout after ${timeoutMs}ms${failOpen ? " — fail_open" : ""}`,
        error: "timeout",
      };
    }

    return {
      url,
      status: null,
      response_time_ms: elapsed,
      ok: false,
      urgency: failOpen ? "warning" : "critical",
      reason: `network error: ${error.message}${failOpen ? " — fail_open" : ""}`,
      error: error.message,
    };
  }
}
