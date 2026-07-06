/**
 * Site AEO Checker — URL-based scan API
 *
 * POST /api/site-check        { url } → scan a website, persist, return result
 * GET  /api/site-check/:id            → fetch a saved scan (shareable ?r=<id>)
 *
 * Unlike the service-name checker (which reads aeo-data.json from the
 * KanseiLink DB), this endpoint fetches the target site server-side and
 * evaluates how visible / recommendable it is to AI agents:
 *   - AI crawler access (robots.txt blocks for GPTBot, ClaudeBot, ...)
 *   - Structured data (JSON-LD presence + relevant @type)
 *   - Machine readability (raw-HTML text volume, contact info, lang)
 *   - AEO basics (title, description, canonical, OGP, sitemap, llms.txt)
 *
 * No LLM calls — pure fetch + parse, so marginal cost is ~zero.
 */

import type { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getDb } from "./db/connection.js";

const USER_AGENT =
  "KanseiLink-SiteChecker/1.0 (+https://kansei-link.com/site-checker/)";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 3_000_000;
const MAX_REDIRECTS = 3;

// AI crawlers whose robots.txt access determines agent visibility.
// Blocking any of these means the site is invisible to that engine.
const AI_BOTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
];

// JSON-LD @types that signal a business entity AI agents can recommend
const RELEVANT_LD_TYPES = [
  "Organization",
  "LocalBusiness",
  "Corporation",
  "Store",
  "Restaurant",
  "Product",
  "Service",
  "FAQPage",
  "WebSite",
  "BreadcrumbList",
  "Article",
];

type Severity = "critical" | "warn" | "info" | "ok";

interface Finding {
  id: string;
  severity: Severity;
  points: number; // earned
  max: number; // possible
  label: string; // ja
  label_en: string;
  advice: string; // ja (empty when ok)
  advice_en: string;
}

export interface SiteCheckResult {
  id: string;
  url: string;
  final_url: string;
  score: number;
  grade: string;
  findings: Finding[];
  created_at: string;
}

// ─── SSRF guard ────────────────────────────────────────────────────

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) // CGNAT
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7)); // v4-mapped
  return (
    v6 === "::1" ||
    v6 === "::" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe80")
  );
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new SiteCheckError("private_host", `Host not allowed: ${hostname}`);
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) {
      throw new SiteCheckError("private_host", `IP not allowed: ${hostname}`);
    }
    return;
  }
  let addrs;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new SiteCheckError("dns_failed", `DNS lookup failed for ${hostname}`);
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new SiteCheckError("private_host", `Host resolves to a private address: ${hostname}`);
  }
}

class SiteCheckError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

// ─── Guarded fetch (manual redirects, each hop re-validated) ──────

async function guardedFetch(rawUrl: string): Promise<{ res: globalThis.Response; finalUrl: string }> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new SiteCheckError("bad_scheme", `Unsupported scheme: ${url.protocol}`);
    }
    await assertPublicHost(url.hostname);
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain,*/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { res, finalUrl: url.href };
      res.body?.cancel();
      url = new URL(loc, url);
      continue;
    }
    return { res, finalUrl: url.href };
  }
  throw new SiteCheckError("too_many_redirects", "Too many redirects");
}

async function readBodyCapped(res: globalThis.Response): Promise<string> {
  const text = await res.text();
  return text.length > MAX_BODY_BYTES ? text.slice(0, MAX_BODY_BYTES) : text;
}

/** Fetch a sibling resource (robots.txt etc.); null when unreachable or non-200. */
async function fetchAux(origin: string, path: string): Promise<string | null> {
  try {
    const { res } = await guardedFetch(origin + path);
    if (!res.ok) {
      res.body?.cancel();
      return null;
    }
    // Many sites serve a soft-404 HTML page for missing files —
    // robots.txt / llms.txt / sitemap.xml should never be text/html.
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/html")) {
      res.body?.cancel();
      return null;
    }
    return await readBodyCapped(res);
  } catch {
    return null;
  }
}

// ─── robots.txt parsing ────────────────────────────────────────────

/** Returns the list of AI bots that are fully blocked (Disallow: /) */
function blockedAiBots(robotsTxt: string): string[] {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  const groups: { agents: string[]; disallowAll: boolean }[] = [];
  let current: { agents: string[]; disallowAll: boolean } | null = null;
  let lastWasAgent = false;

  for (const line of lines) {
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], disallowAll: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      if (field === "disallow" && current && value === "/") {
        current.disallowAll = true;
      }
      lastWasAgent = false;
    }
  }

  return AI_BOTS.filter((bot) =>
    groups.some((g) => g.disallowAll && g.agents.includes(bot.toLowerCase()))
  );
}

// ─── HTML signal extraction (regex-based; no DOM dependency) ──────

interface HtmlSignals {
  title: string | null;
  metaDescription: string | null;
  canonical: boolean;
  ogTitle: boolean;
  ogDescription: boolean;
  ogImage: boolean;
  lang: string | null;
  jsonLdCount: number;
  jsonLdTypes: string[];
  sameAsPlatforms: string[];
  textChars: number;
  hasTel: boolean;
  hasAddress: boolean;
  hasHours: boolean;
}

// External platforms AI agents use to cross-verify a business entity.
// Detected from JSON-LD sameAs / hasMap URLs.
const ENTITY_PLATFORMS: { name: string; re: RegExp }[] = [
  { name: "Googleマップ", re: /(google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|g\.page)/i },
  { name: "食べログ", re: /tabelog\.com/i },
  { name: "ぐるなび", re: /gnavi\.co\.jp/i },
  { name: "ホットペッパー", re: /hotpepper\.jp/i },
  { name: "Instagram", re: /instagram\.com/i },
  { name: "Facebook", re: /facebook\.com/i },
  { name: "X (Twitter)", re: /(twitter\.com|x\.com)/i },
  { name: "LINE", re: /(line\.me|lin\.ee)/i },
  { name: "YouTube", re: /youtube\.com/i },
  { name: "LinkedIn", re: /linkedin\.com/i },
  { name: "Wikipedia/Wikidata", re: /(wikipedia\.org|wikidata\.org)/i },
];

function attrContent(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function collectLdTypes(node: unknown, types: Set<string>, sameAsUrls: Set<string>): void {
  if (Array.isArray(node)) {
    node.forEach((n) => collectLdTypes(n, types, sameAsUrls));
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") types.add(t);
    if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
    for (const key of ["sameAs", "hasMap"]) {
      const v = obj[key];
      if (typeof v === "string") sameAsUrls.add(v);
      if (Array.isArray(v)) v.forEach((x) => typeof x === "string" && sameAsUrls.add(x));
    }
    if (obj["@graph"]) collectLdTypes(obj["@graph"], types, sameAsUrls);
  }
}

function extractHtmlSignals(html: string): HtmlSignals {
  // JSON-LD blocks
  const ldTypes = new Set<string>();
  const sameAsUrls = new Set<string>();
  let jsonLdCount = 0;
  const ldRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(ldRe)) {
    jsonLdCount++;
    try {
      collectLdTypes(JSON.parse(m[1]), ldTypes, sameAsUrls);
    } catch {
      /* malformed JSON-LD still counts as present */
    }
  }
  const allSameAs = Array.from(sameAsUrls).join("\n");
  const sameAsPlatforms = ENTITY_PLATFORMS.filter((p) => p.re.test(allSameAs)).map((p) => p.name);

  // Visible-ish text: strip scripts/styles/tags, collapse whitespace
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const phoneRe = /(tel:|0\d{1,4}[-(）)]\d{1,4}[-)]?\d{3,4})/;
  const addressRe = /(〒\s*\d{3}[-ー]\d{4}|住所|所在地|address)/i;
  const hoursRe = /(営業時間|受付時間|定休日|opening ?hours)/i;

  return {
    title: attrContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    metaDescription: attrContent(
      html,
      /<meta[^>]+name\s*=\s*["']description["'][^>]+content\s*=\s*["']([^"']*)["']/i
    ) ?? attrContent(html, /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+name\s*=\s*["']description["']/i),
    canonical: /<link[^>]+rel\s*=\s*["']canonical["']/i.test(html),
    ogTitle: /<meta[^>]+property\s*=\s*["']og:title["']/i.test(html),
    ogDescription: /<meta[^>]+property\s*=\s*["']og:description["']/i.test(html),
    ogImage: /<meta[^>]+property\s*=\s*["']og:image["']/i.test(html),
    lang: attrContent(html, /<html[^>]+lang\s*=\s*["']([^"']+)["']/i),
    jsonLdCount,
    jsonLdTypes: Array.from(ldTypes),
    sameAsPlatforms,
    textChars: text.length,
    hasTel: phoneRe.test(html),
    hasAddress: addressRe.test(text),
    hasHours: hoursRe.test(text),
  };
}

// ─── Scoring ───────────────────────────────────────────────────────

function grade(score: number): string {
  if (score >= 90) return "AAA";
  if (score >= 80) return "AA";
  if (score >= 70) return "A";
  if (score >= 55) return "BBB";
  if (score >= 40) return "BB";
  if (score >= 25) return "B";
  return "CCC";
}

function f(
  id: string,
  ok: boolean | "partial",
  max: number,
  earned: number,
  severityWhenBad: Severity,
  labels: { ja: string; en: string; adviceJa: string; adviceEn: string }
): Finding {
  return {
    id,
    severity: ok === true ? "ok" : severityWhenBad,
    points: earned,
    max,
    label: labels.ja,
    label_en: labels.en,
    advice: ok === true ? "" : labels.adviceJa,
    advice_en: ok === true ? "" : labels.adviceEn,
  };
}

function evaluate(signals: HtmlSignals, blocked: string[], robotsFound: boolean, llmsTxt: boolean, sitemap: boolean, finalUrl: string): Finding[] {
  const findings: Finding[] = [];

  // ── AI crawler access (25) ──
  const crawlerOk = blocked.length === 0;
  findings.push(
    f("ai_crawlers", crawlerOk, 25, crawlerOk ? 25 : Math.max(0, 25 - blocked.length * 10), "critical", {
      ja: crawlerOk
        ? "ChatGPTなどのAIがサイトを読める設定になっています"
        : `AIがサイトを読めない設定になっています（${blocked.join(", ")} をブロック中）`,
      en: crawlerOk
        ? "AI services can read your site"
        : `Your site is blocking AI services (${blocked.join(", ")})`,
      adviceJa:
        "このままだと、お客様がChatGPTやAI検索で調べても御社は回答に出てきません。サイトの設定ファイル1行で解除できる問題です（解除手順はフルレポートでご案内します）。",
      adviceEn:
        "Customers asking ChatGPT or AI search about your business will never see you. This is a one-line settings fix (details in the full report).",
    })
  );

  // ── Structured data (20) ──
  const hasLd = signals.jsonLdCount > 0;
  const hasRelevantType = signals.jsonLdTypes.some((t) => RELEVANT_LD_TYPES.includes(t));
  findings.push(
    f("jsonld", hasLd, 12, hasLd ? 12 : 0, "critical", {
      ja: hasLd
        ? `会社情報が「AIが読める形式」で書かれています（構造化データ ${signals.jsonLdCount}箇所）`
        : "会社情報が「AIが読める形式」で書かれていません（構造化データ未設置）",
      en: hasLd
        ? `Your business info is written in AI-readable form (${signals.jsonLdCount} blocks)`
        : "Your business info is not written in AI-readable form (no structured data)",
      adviceJa:
        "人間のお客様には見えていても、AIには「何の会社か・何を売っているか」が伝わっていない状態です。AIに正しく紹介してもらうための専用の記述を追加する必要があります。",
      adviceEn:
        "Human visitors can see your site, but AI cannot tell what your business is or sells. A dedicated markup block fixes this.",
    })
  );
  findings.push(
    f("jsonld_types", !hasLd ? false : hasRelevantType, 8, hasRelevantType ? 8 : 0, "warn", {
      ja: hasRelevantType
        ? `事業内容（会社・店舗・商品）がAIに宣言されています（${signals.jsonLdTypes.filter((t) => RELEVANT_LD_TYPES.includes(t)).join(", ")}）`
        : "「どんな事業か」のAI向けの宣言がありません",
      en: hasRelevantType
        ? `Your business type is declared to AI (${signals.jsonLdTypes.filter((t) => RELEVANT_LD_TYPES.includes(t)).join(", ")})`
        : "Your business type is not declared to AI",
      adviceJa:
        "「会社なのか・お店なのか・何を売っているのか」をAIが確実に理解できる形で宣言すると、AIからの紹介・推薦の精度が上がります。",
      adviceEn:
        "Declaring whether you are a company, a shop, or a product seller lets AI cite and recommend you accurately.",
    })
  );

  // ── Entity linkage (unscored teaser — the "so that's what AI checks" hook) ──
  // AI agents cross-verify a business against Google Maps / review portals /
  // social profiles before recommending it. sameAs/hasMap in JSON-LD is how a
  // site declares "this page and that listing are the same business".
  const platforms = signals.sameAsPlatforms;
  findings.push(
    f("entity_links", platforms.length > 0, 0, 0, "warn", {
      ja:
        platforms.length > 0
          ? `外部サービスとの「同一事業者の紐づけ」がAIに伝わっています（${platforms.join("・")}）`
          : "Googleマップ・グルメサイト・SNSとの「同一事業者の紐づけ」がAIに伝わっていません",
      en:
        platforms.length > 0
          ? `AI can link your site to your external profiles (${platforms.join(", ")})`
          : "AI cannot link your site to Google Maps, review portals or social profiles",
      adviceJa:
        "AIはお店や会社を推薦する前に、公式サイト・Googleマップ・口コミサイトが同じ事業者か照合します。紐づけが宣言されていないと「情報を確認できない事業者」として推薦の優先度が下がります。紐づけの設定方法はフルレポートでご案内します。",
      adviceEn:
        "Before recommending a business, AI cross-checks that its website, Google Maps listing and review pages belong to the same entity. Without a declared link, you rank lower as 'unverifiable'. The full report covers how to set this up.",
    })
  );

  // ── Machine readability (25) ──
  const textOk = signals.textChars >= 300;
  findings.push(
    f("text_visibility", textOk, 10, textOk ? 10 : 0, "critical", {
      ja: textOk
        ? `ページの文章をAIが読み取れています（約${signals.textChars.toLocaleString()}文字）`
        : "AIには、このページがほぼ白紙に見えています",
      en: textOk
        ? `AI can read your page text (~${signals.textChars.toLocaleString()} chars)`
        : "To AI, this page looks nearly blank",
      adviceJa:
        "人間には普通に見えていても、AIが読み取れる文字がほとんどありません。サイトの作り（表示の仕組み）に起因する問題で、このままだとAI経由の集客はゼロになります。",
      adviceEn:
        "The page looks normal to humans, but AI can barely read any text. This comes from how the site is built — left as-is, AI-driven traffic stays at zero.",
    })
  );
  const contactCount = [signals.hasTel, signals.hasAddress, signals.hasHours].filter(Boolean).length;
  const contactOk = contactCount >= 2;
  findings.push(
    f("contact_info", contactOk ? true : contactCount === 1 ? "partial" : false, 10, contactCount >= 2 ? 10 : contactCount * 5, "warn", {
      ja: contactOk
        ? "電話番号・住所・営業時間をAIが見つけられます"
        : "電話番号・住所・営業時間をAIが見つけられません",
      en: contactOk
        ? "AI can find your phone, address and hours"
        : "AI cannot find your phone, address or hours",
      adviceJa:
        "「近くの〇〇を探して」とAIに聞いたお客様に、御社が案内されない状態です。住所・電話・営業時間は画像ではなく文字で載せる必要があります（画像の中の文字はAIには読めません）。",
      adviceEn:
        "Customers asking AI to 'find a nearby ...' won't be sent to you. Address, phone and hours must be text, not images — AI cannot read text inside images.",
    })
  );
  const langOk = !!signals.lang;
  findings.push(
    f("lang_attr", langOk, 5, langOk ? 5 : 0, "info", {
      ja: langOk ? `サイトの言語が明示されています（${signals.lang}）` : "サイトの言語設定がありません",
      en: langOk ? `Site language is declared (${signals.lang})` : "Site language is not declared",
      adviceJa: "「これは日本語のサイトです」とAIに明示する設定です。ないとAIが言語を誤認識することがあります。",
      adviceEn: "A one-line setting that tells AI what language your site is in — without it, AI may misdetect it.",
    })
  );

  // ── AEO basics (30) ──
  const titleOk = !!signals.title && signals.title.length >= 5;
  findings.push(
    f("title", titleOk, 5, titleOk ? 5 : 0, "warn", {
      ja: titleOk ? "ページの題名（タイトル）が設定されています" : "ページの題名（タイトル）が未設定か短すぎます",
      en: titleOk ? "Page title is set" : "Page title missing or too short",
      adviceJa: "検索結果やAIの回答に表示される「会社の顔」です。「社名＋何をしている会社か」が分かる題名にしましょう。",
      adviceEn: "This is your storefront in search and AI answers — use 'Company name + what you do'.",
    })
  );
  const descOk = !!signals.metaDescription && signals.metaDescription.length >= 30;
  findings.push(
    f("meta_description", descOk, 5, descOk ? 5 : 0, "warn", {
      ja: descOk ? "サイトの紹介文が設定されています" : "サイトの紹介文が未設定か短すぎます",
      en: descOk ? "Site description is set" : "Site description missing or too short",
      adviceJa: "AIや検索エンジンはこの紹介文をそのまま引用します。未設定だと、AIが御社の説明を勝手に作ってしまいます。事業内容・お客様・地域が伝わる文にしましょう。",
      adviceEn: "AI and search engines quote this description verbatim. Without one, AI invents its own description of your business.",
    })
  );
  findings.push(
    f("canonical", signals.canonical, 4, signals.canonical ? 4 : 0, "info", {
      ja: signals.canonical ? "ページの「正式なURL」が宣言されています" : "ページの「正式なURL」が宣言されていません",
      en: signals.canonical ? "Official page URL is declared" : "Official page URL is not declared",
      adviceJa: "同じページが複数のURLで見えると、評価が割れて順位が下がります。正式なURLを1つ宣言しておくのが基本です（canonical設定）。",
      adviceEn: "When one page is reachable at several URLs, its ranking gets split. Declaring one official URL (canonical) prevents this.",
    })
  );
  const ogCount = [signals.ogTitle, signals.ogDescription, signals.ogImage].filter(Boolean).length;
  const ogOk = ogCount === 3;
  findings.push(
    f("ogp", ogOk ? true : ogCount > 0 ? "partial" : false, 6, ogCount * 2, "warn", {
      ja: ogOk ? "SNSでリンクを貼ったときの表示情報が揃っています" : `SNSでリンクを貼ったときの表示情報が不足しています（${ogCount}/3）`,
      en: ogOk ? "Link-preview info for social media is complete" : `Link-preview info for social media is incomplete (${ogCount}/3)`,
      adviceJa: "LINEやSNSで御社のリンクが共有されたとき、タイトルや画像が正しく出ません。せっかくの口コミ共有からの来訪を逃します（OGP設定）。",
      adviceEn: "When your link is shared on LINE or social media, the title and image won't display properly — you lose word-of-mouth traffic (OGP tags).",
    })
  );
  findings.push(
    f("sitemap", sitemap, 5, sitemap ? 5 : 0, "warn", {
      ja: sitemap ? "サイトの案内図（sitemap）が公開されています" : "サイトの案内図（sitemap）がありません",
      en: sitemap ? "Site map file (sitemap) is published" : "No site map file (sitemap)",
      adviceJa: "AIや検索エンジンに「このサイトにはどんなページがあるか」を伝えるファイルです。ないとページの見落としが起きます。",
      adviceEn: "A file that tells AI and search engines every page you have — without it, pages get missed.",
    })
  );
  findings.push(
    f("llms_txt", llmsTxt, 5, llmsTxt ? 5 : 0, "info", {
      ja: llmsTxt ? "AI向けのサイト案内ファイル（llms.txt）が公開されています" : "AI向けのサイト案内ファイル（llms.txt）がありません",
      en: llmsTxt ? "AI site-guide file (llms.txt) is published" : "No AI site-guide file (llms.txt)",
      adviceJa: "AIに「どのページを見れば何が分かるか」を案内する新しい仕組みです。設置している中小企業はまだ少なく、今なら競合との差別化になります。",
      adviceEn: "A new standard that guides AI to your key pages. Few SMBs have one yet — an easy differentiator right now.",
    })
  );

  // HTTPS check (informational; deducts nothing but flags http)
  if (finalUrl.startsWith("http://")) {
    findings.push(
      f("https", false, 0, 0, "critical", {
        ja: "サイトが暗号化されていません（鍵マークが出ないサイト）",
        en: "Site is not encrypted (no padlock in the browser)",
        adviceJa: "ブラウザに「保護されていない通信」と警告が出る状態です。お客様の信頼を損ない、AI・検索エンジン双方でも大きく不利になります。",
        adviceEn: "Browsers show a 'Not secure' warning on your site. It costs customer trust and ranks poorly with both AI and search engines.",
      })
    );
  }

  // robots.txt missing is fine for AI access but worth noting
  if (!robotsFound) {
    findings.push(
      f("robots_missing", "partial", 0, 0, "info", {
        ja: "クローラー向けの設定ファイル（robots.txt）がありません（AIブロックはない状態です）",
        en: "No crawler settings file (robots.txt) — nothing is blocking AI",
        adviceJa: "問題ではありませんが、設置しておくとサイトの案内図（sitemap）をAIに伝えられます。",
        adviceEn: "Not a problem, but having one lets you point AI to your site map.",
      })
    );
  }

  return findings;
}

// ─── Main scan ─────────────────────────────────────────────────────

export async function runSiteCheck(rawUrl: string): Promise<Omit<SiteCheckResult, "id" | "created_at">> {
  let input = rawUrl.trim();
  if (!/^https?:\/\//i.test(input)) input = "https://" + input;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new SiteCheckError("bad_url", "Invalid URL");
  }

  const { res, finalUrl } = await guardedFetch(parsed.href);
  if (!res.ok) {
    res.body?.cancel();
    throw new SiteCheckError("fetch_failed", `Site returned HTTP ${res.status}`);
  }
  const html = await readBodyCapped(res);
  const origin = new URL(finalUrl).origin;

  const [robotsTxt, llmsTxt, sitemapXml] = await Promise.all([
    fetchAux(origin, "/robots.txt"),
    fetchAux(origin, "/llms.txt"),
    fetchAux(origin, "/sitemap.xml"),
  ]);

  const signals = extractHtmlSignals(html);
  const blocked = robotsTxt ? blockedAiBots(robotsTxt) : [];
  const findings = evaluate(signals, blocked, robotsTxt !== null, llmsTxt !== null, sitemapXml !== null, finalUrl);

  const score = Math.min(
    100,
    findings.reduce((sum, x) => sum + x.points, 0)
  );

  return { url: parsed.href, final_url: finalUrl, score, grade: grade(score), findings };
}

// ─── Express handlers ──────────────────────────────────────────────

export async function handleSiteCheck(req: Request, res: Response): Promise<void> {
  const url = typeof req.body?.url === "string" ? req.body.url : "";
  if (!url || url.length > 500) {
    res.status(400).json({ error: "Provide a valid `url` (string, ≤500 chars)." });
    return;
  }
  try {
    const result = await runSiteCheck(url);
    const id = randomBytes(6).toString("hex");
    const ipHash = createHash("sha256")
      .update(req.ip ?? "unknown")
      .digest("hex")
      .slice(0, 16);
    getDb()
      .prepare(
        `INSERT INTO site_checks (id, url, score, grade, findings, raw_signals, ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, result.final_url, result.score, result.grade, JSON.stringify(result.findings), "{}", ipHash);
    res.json({ id, ...result });
  } catch (err) {
    if (err instanceof SiteCheckError) {
      const status = err.code === "bad_url" || err.code === "bad_scheme" ? 400 : 422;
      res.status(status).json({ error: err.message, code: err.code });
      return;
    }
    const message = err instanceof Error && err.name === "TimeoutError" ? "Site took too long to respond (>10s)" : "Scan failed";
    res.status(422).json({ error: message, code: "scan_failed" });
  }
}

export function handleSiteCheckGet(req: Request, res: Response): void {
  const id = String(req.params.id ?? "");
  if (!/^[0-9a-f]{12}$/.test(id)) {
    res.status(400).json({ error: "Invalid report id" });
    return;
  }
  const row = getDb()
    .prepare("SELECT id, url, score, grade, findings, created_at FROM site_checks WHERE id = ?")
    .get(id) as { id: string; url: string; score: number; grade: string; findings: string; created_at: string } | undefined;
  if (!row) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json({ ...row, findings: JSON.parse(row.findings) });
}
