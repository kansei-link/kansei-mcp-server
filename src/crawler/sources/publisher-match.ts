/**
 * レジストリのサーバーと、手作業で登録したサービス行を「発行元のドメイン」で突き合わせる。
 *
 * これまでの結合は派生idの完全一致だけだった（sync-registry.ts）:
 *
 *   io.github.square/square-mcp-server  →  io-github-square-square-mcp-server
 *
 * これが curated な `square` と一致することは構造上ありえないため、既存行は永久に
 * enrich されず、公式MCPがあるサービスに「接続方法なし」を配り続けていた
 * （founder-ops/RCA-MCP-Ingestion_2026-09-04.md ②）。
 *
 * ドメインで突き合わせれば、id の付け方に依存せずに同一性を判断できる。
 * 判断材料は強い順に:
 *   1. websiteUrl        … 発行元が自分で書いた製品URL。最も確か
 *   2. ネームスペースの逆引き … レジストリの命名規約（`ac.tandem` → `tandem.ac`）
 *   3. リポジトリURL      … ただし github.com 等の共有ホストは除外する。
 *                          これを入れると全サーバーが同一ドメイン扱いになって壊れる
 */

/** 複数ラベルのTLD。これを見ないと co.jp が全部同じドメインに潰れる。 */
const MULTI_PART_TLDS = new Set([
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp", "ed.jp", "gr.jp", "lg.jp",
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au", "com.br", "com.cn", "com.hk", "com.mx",
  "com.sg", "com.tw", "com.tr", "co.kr", "co.nz", "co.in", "co.za", "co.il",
]);

/**
 * 発行元が誰かを判断できないホスト。ここに載るドメインで一致しても意味がない
 * ——「GitHubでホストされている」は「同じ会社の製品」ではないため。
 */
const SHARED_HOSTS = new Set([
  "github.com", "gitlab.com", "bitbucket.org", "sourceforge.net",
  "npmjs.com", "pypi.org", "hub.docker.com", "docker.com",
  "vercel.app", "netlify.app", "herokuapp.com", "railway.app", "fly.dev",
  "readthedocs.io", "gitbook.io", "notion.site", "glitch.me",
  "smithery.ai", "mcp.so", "lobehub.com", "modelcontextprotocol.io",
]);

/** URL から登録可能ドメイン（eTLD+1）を取り出す。判断できなければ null。 */
export function registrableDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let host: string;
  try {
    host = new URL(input.includes("://") ? input : `https://${input}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.startsWith("www.")) host = host.slice(4);
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  const lastTwo = parts.slice(-2).join(".");
  const domain = parts.length >= 3 && MULTI_PART_TLDS.has(lastTwo)
    ? parts.slice(-3).join(".")
    : lastTwo;
  return SHARED_HOSTS.has(domain) ? null : domain;
}

/**
 * レジストリ名のネームスペースを逆引きしてドメインにする。
 *   "ac.tandem/docs-mcp"     -> "tandem.ac"
 *   "com.squareup/foo"       -> "squareup.com"
 *   "io.github.makenotion/x" -> null（発行元は GitHub 上の組織で、製品ドメインではない）
 */
export function namespaceToDomain(registryName: string): string | null {
  const ns = registryName.split("/")[0];
  if (!ns || !ns.includes(".")) return null;
  // io.github.<org> は「GitHubの組織」であって製品のドメインではない。
  // ここで拾うと全部 github.com に寄ってしまうので扱わない（RCA ③）。
  if (ns.startsWith("io.github.") || ns === "io.github") return null;
  const domain = ns.split(".").reverse().join(".");
  return registrableDomain(domain);
}

export interface RegistryLike {
  name: string;
  website_url?: string | null;
  repo_url?: string | null;
}

/**
 * そのサーバーの発行元と考えられるドメイン群。確かな順に返す。
 * 一致は「どれか1つでも一致すれば同一発行元」と扱う。
 */
export function publisherDomains(server: RegistryLike): string[] {
  const out: string[] = [];
  const push = (d: string | null) => { if (d && !out.includes(d)) out.push(d); };
  push(registrableDomain(server.website_url));
  push(namespaceToDomain(server.name));
  push(registrableDomain(server.repo_url)); // SHARED_HOSTS は registrableDomain が落とす
  return out;
}

/**
 * サービス行に対して、同じ発行元と判断できるレジストリサーバーを探す。
 * 一致した場合、そのサーバーはそのサービスの一次提供と見なせる。
 */
export function matchByPublisher<T extends RegistryLike>(
  serviceApiUrl: string | null | undefined,
  servers: T[]
): T | null {
  const target = registrableDomain(serviceApiUrl);
  if (!target) return null;
  for (const s of servers) {
    if (publisherDomains(s).includes(target)) return s;
  }
  return null;
}

// ── mcp_status の出所 ───────────────────────────────────────────────
//
// 同じ `official` でも、根拠の強さがまったく違う:
//   - 人が一次資料で確認した（verdicts.json・evidence_url 必須）
//   - 発行元が製品ドメインを保有していることをレジストリのネームスペースで確認できる
//   - レジストリの推論（通信方式がHTTP/SSEなら official）——発行元を見ていない
//
// 最後のものが等級を動かしていたのが RCA ③。ここでは値を書き換えず、
// 「どの根拠で付いた値か」を判定できるようにする。値の書き換えと等級への反映は
// ④（raw を等級の自動決定者から外す）で一度だけ行う。
//
// スキーマは変更しない。namespace から導出できるため、配布データでもそのまま判定できる。

export type StatusProvenance =
  /** 人が一次資料で確認した。最も強い */
  | "verdict"
  /** 発行元が製品ドメインを保有（レジストリのDNS検証済みネームスペース） */
  | "publisher_verified"
  /** レジストリの推論のみ。発行元を見ていないので、等級の根拠にはできない */
  | "registry_inferred"
  /** 手作業で登録した行。レジストリ由来ではない */
  | "curated";

export function statusProvenance(
  service: { id: string; namespace?: string | null },
  adjudicatedIds?: ReadonlySet<string>
): StatusProvenance {
  if (adjudicatedIds?.has(service.id)) return "verdict";
  const ns = service.namespace?.trim();
  if (!ns) return "curated";
  // io.github.<org> は GitHub 上の組織であって製品ドメインの保有証明にはならない。
  // 組織が製品の持ち主であることは十分ありうるが（例: makenotion）、
  // それを機械で確かめる手段が無いので、ここでは推論扱いに留める。
  return namespaceToDomain(ns) ? "publisher_verified" : "registry_inferred";
}
