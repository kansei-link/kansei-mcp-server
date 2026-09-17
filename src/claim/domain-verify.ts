/**
 * Claim MVP — domain verification (PLAN-Profile-Claim-MVP v1 rev3 §4.1).
 *
 * Verdicts, not side effects: this module CLASSIFIES an applicant
 * (email or domain) against a service's official domain. Persistence,
 * nonce issuance, and status transitions live in the handlers.
 *
 * Hardening (rev3 / implementation conditions):
 *   - eTLD+1 comparison via the Public Suffix List (bare public suffixes
 *     like "co.jp" can never be claimed)
 *   - shared-hosting suffixes (github.io etc.) and freemail providers are
 *     structurally rejected
 *   - IDN: domains are punycode-normalized; any xn-- label (or non-ASCII
 *     input) is NEVER auto-approved — routed to manual review (homograph
 *     risk; the shanon.co.xn--jp-883ati incident class)
 *   - manual exception path exists but every use must be recorded with a
 *     reason enum in the audit log (handlers enforce)
 */

import psl from "psl";
import { domainToASCII } from "node:url";

export type DomainVerdict =
  | { verdict: "match"; etld1: string }
  | { verdict: "manual_review"; reason: "homograph_review"; etld1: string | null }
  | { verdict: "reject"; reason: "psl_rejected" | "freemail_rejected" | "mismatch" | "invalid" };

// Freemail providers — an applicant address on these can never establish
// organizational control of a domain.
const FREEMAIL = new Set([
  "gmail.com", "yahoo.co.jp", "yahoo.com", "outlook.com", "hotmail.com", "hotmail.co.jp",
  "icloud.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
  "docomo.ne.jp", "ezweb.ne.jp", "softbank.ne.jp", "i.softbank.jp",
]);

// Shared-hosting / PaaS suffixes: the PSL private section makes user.github.io
// its own "eTLD+1", which would let anyone claim via a free subdomain. These
// suffixes are organizational hosting, not organizational identity.
const SHARED_HOSTING_SUFFIXES = [
  "github.io", "gitlab.io", "netlify.app", "vercel.app", "pages.dev", "web.app",
  "firebaseapp.com", "herokuapp.com", "onrender.com", "up.railway.app",
  "amazonaws.com", "azurewebsites.net", "cloudfront.net", "appspot.com",
];

/** Normalize to ASCII (punycode). Returns null if not normalizable. */
export function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed || trimmed.length > 253) return null;
  const ascii = domainToASCII(trimmed);
  return ascii || null;
}

/** True if the (normalized) domain contains any IDN label — manual review only. */
export function hasIdnLabel(asciiDomain: string): boolean {
  return asciiDomain.split(".").some((label) => label.startsWith("xn--"));
}

/** eTLD+1 via PSL; null for bare public suffixes / invalid input. */
export function etld1(asciiDomain: string): string | null {
  const got = psl.get(asciiDomain);
  return got ?? null;
}

function isSharedHosting(asciiDomain: string): boolean {
  return SHARED_HOSTING_SUFFIXES.some((s) => asciiDomain === s || asciiDomain.endsWith(`.${s}`));
}

/**
 * Classify applicantDomain (from the applicant's email, or the domain they
 * placed a TXT record on) against the service's official site domain.
 */
export function verifyDomain(applicantRaw: string, officialRaw: string): DomainVerdict {
  const applicant = normalizeDomain(applicantRaw);
  const official = normalizeDomain(officialRaw);
  if (!applicant || !official) return { verdict: "reject", reason: "invalid" };

  if (FREEMAIL.has(applicant)) return { verdict: "reject", reason: "freemail_rejected" };
  if (isSharedHosting(applicant)) return { verdict: "reject", reason: "psl_rejected" };

  const a1 = etld1(applicant);
  const o1 = etld1(official);
  if (!a1 || !o1) return { verdict: "reject", reason: "psl_rejected" };

  // IDN anywhere on either side → never auto-approve (homograph risk).
  if (hasIdnLabel(applicant) || hasIdnLabel(official)) {
    return { verdict: "manual_review", reason: "homograph_review", etld1: a1 };
  }

  if (a1 === o1) return { verdict: "match", etld1: a1 };
  return { verdict: "reject", reason: "mismatch" };
}

export const NONCE_TTL_DAYS = 7;

/** TXT record value expected for DNS verification. */
export function txtRecordValue(nonce: string): string {
  return `kansei-link-verify=${nonce}`;
}
