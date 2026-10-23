import { BlockList, isIP } from "node:net";
import type { Request } from "express";

/**
 * The visitor's IP behind Cloudflare (2026-10-24, mcp.kansei-link.com).
 *
 * Path: visitor → Cloudflare (proxied) → Railway edge → this app. Express is set to
 * `trust proxy = 1` (one hop: Railway), so `req.ip` is the address that connected to Railway —
 * on the Cloudflare path that is a Cloudflare edge address, not the visitor. Keying the rate
 * limiters, ask_log and site-check hashes on it would mean "one bucket per Cloudflare edge".
 *
 * Rule (INSTRUCTION-agent-url-switch-mcp-domain §0): trust `CF-Connecting-IP` ONLY when the
 * direct sender (`req.ip`) is inside Cloudflare's published ranges. A request that reaches
 * railway.app directly with a forged `CF-Connecting-IP` keeps `req.ip` (its own address),
 * because its direct sender is not Cloudflare. Nothing else changes: no new header is trusted
 * on the direct path, and `X-Forwarded-For` is still read through `trust proxy = 1` only.
 *
 * Ranges: https://www.cloudflare.com/ips-v4 and /ips-v6 as of 2026-10-24 ("do not change
 * frequently; added to the list before being put into production"). CLOUDFLARE_IP_RANGES
 * (comma-separated CIDRs) replaces the built-in list without a release.
 */
export const CLOUDFLARE_RANGES_BUILTIN = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32",
];

export function buildCloudflareList(ranges: readonly string[] = rangesFromEnv()): BlockList {
  const list = new BlockList();
  for (const r of ranges) {
    const [net, bits] = r.trim().split("/");
    const fam = isIP(net);
    const prefix = Number(bits);
    if (!fam || !Number.isInteger(prefix)) continue; // a malformed entry is skipped, never widened
    list.addSubnet(net, prefix, fam === 6 ? "ipv6" : "ipv4");
  }
  return list;
}

function rangesFromEnv(): readonly string[] {
  const env = (process.env.CLOUDFLARE_IP_RANGES ?? "").trim();
  return env ? env.split(",") : CLOUDFLARE_RANGES_BUILTIN;
}

let cached: BlockList | null = null;
function cloudflare(): BlockList {
  return (cached ??= buildCloudflareList());
}

/** For tests: forget the cached list (after changing CLOUDFLARE_IP_RANGES). */
export function resetCloudflareListForTests(): void {
  cached = null;
}

/** Normalise an address for the block list: strip the IPv4-mapped prefix, zone ids, brackets. */
function normalise(ip: string): { ip: string; fam: 4 | 6 } | null {
  let v = ip.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v);
  if (m) v = m[1];
  const fam = isIP(v);
  return fam === 4 || fam === 6 ? { ip: v, fam } : null;
}

export function isCloudflareIp(ip: string | undefined | null): boolean {
  const n = ip ? normalise(ip) : null;
  if (!n) return false;
  try {
    return cloudflare().check(n.ip, n.fam === 6 ? "ipv6" : "ipv4");
  } catch {
    return false;
  }
}

/**
 * The address to rate-limit and hash on. `req.ip` (trust proxy = 1) unless the direct sender is a
 * Cloudflare edge and it passed a well-formed CF-Connecting-IP — then that visitor address.
 * Never throws; falls back to `req.ip`, then the socket, then "unknown".
 */
export function clientIp(req: Pick<Request, "ip" | "header"> & { socket?: { remoteAddress?: string } }): string {
  const direct = (req.ip || req.socket?.remoteAddress || "").trim();
  if (direct && isCloudflareIp(direct)) {
    const raw = req.header("cf-connecting-ip");
    const n = typeof raw === "string" ? normalise(raw) : null;
    if (n) return n.ip;
  }
  return direct || "unknown";
}
