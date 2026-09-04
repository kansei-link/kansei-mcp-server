/**
 * ① 取り込みの第2ソース — 事業者の自己申告を検証してから受け入れる。
 *
 * 公式MCPレジストリには一次提供者がほとんど載っていない（RCA ①）。Square も
 * エイトレッドも自社ドキュメントやGitHubで配っていて、レジストリには無い。
 * その穴を事業者自身に埋めてもらうのが Agent Wiki の自己申告だが、
 * 申告をそのまま信じると、なりすまし・兄弟製品の取り違え・格付け目当ての
 * 水増しが一気に入ってくる。ここはその全部を止めるゲート。
 *
 * ## 証明の考え方
 *
 * 「この人はこのサービスの持ち主だ」を、**そのサービス自身のドメインに
 * 置かれた記述**で裏づける。ドメインを支配していない者はその記述を置けない。
 *
 * 経路は2本ある。①の発端になったエイトレッドは経路Bでしか通らない——
 * サーバーが github.com にあり、共有ホストは保有の証明にならないため。
 *
 *   A. 直接保有   … 申告されたエンドポイントがサービス自身のドメイン上にある
 *                   （例: https://mcp.squareup.com/sse ← squareup.com）
 *   B. 裏づけ     … サービス自身のドメイン上のページが、申告されたエンドポイントを
 *                   参照している（例: atled.jp のニュースが GitHub のサーバーを指す）
 *
 * どちらも通らなければ `unverified`。**推測で通さない。**
 *
 * ## このゲートで止まらないもの
 *
 * 兄弟製品の取り違え（freee会計 と freeeサイン、Backlog と Typetalk）は
 * ドメインでは分離できない。今日それで何度も誤りかけた。よって
 * **自動で出せるのは `publisher_verified` まで**とし、製品の対応づけに
 * 疑いがあるものは人の `verdict` に回す。
 */
import { registrableDomain } from "./publisher-match.js";

/** Agent Wiki 側が出す申告。これが両者の契約。 */
export interface VendorSubmission {
  /** KanseiLink のサービスid。どの製品についての申告かを一意に決める */
  service_id: string;
  /** 申告された接続方法。npx コマンド、またはリモートMCPのURL */
  mcp_endpoint: string;
  /** 申告の裏づけになる、事業者自身のページ。**必須**。 */
  evidence_url: string;
  /**
   * サーバーの公開場所（GitHubリポジトリ等）。任意。
   *
   * self-hosted のサーバーでは、**裏づけの対象と接続方法が一致しない**。
   * エイトレッドの接続方法は `npx -y mcp-remote https://<host>/mcp` だが、
   * 自社ニュースが参照しているのはリポジトリURLのほう。
   * 裏づけの照合にはこちらを使い、保存するのは mcp_endpoint。
   */
  repo_url?: string | null;
  /** 申告者の自己申告メール等。検証には使わない（記録のみ） */
  submitted_by?: string | null;
  submitted_at?: string | null;
}

export type VerificationOutcome =
  /** 事業者の保有が確認できた。等級に効く（それでも実測フロアの下） */
  | { status: "publisher_verified"; proof: "direct_host" | "corroborated"; detail: string }
  /** 人が見るべき。自動では上げない */
  | { status: "needs_review"; detail: string }
  /** 通らなかった。等級にも発見性にも反映しない */
  | { status: "unverified"; detail: string };

/** 保有の証明にならないホスト。ここに載るドメイン上に置かれていても意味がない。 */
const NOT_OWNERSHIP_PROOF = new Set([
  "github.com", "gitlab.com", "bitbucket.org", "npmjs.com", "pypi.org",
  "vercel.app", "netlify.app", "herokuapp.com", "railway.app", "fly.dev",
  "notion.site", "gitbook.io", "readthedocs.io", "glitch.me",
  "smithery.ai", "mcp.so", "lobehub.com", "modelcontextprotocol.io",
  "medium.com", "note.com", "qiita.com", "zenn.dev", "hatenablog.com",
  "prtimes.jp", "atpress.ne.jp",  // プレスリリース配信は事業者のドメインではない
]);

/**
 * 申告されたURLから、外部へ取りに行ってよいかを判断する。
 *
 * 事業者が任意のURLを入れられる以上、これは我々のサーバーから任意の宛先へ
 * リクエストを飛ばせる口になる。内部ネットワークへ向けさせない。
 */
export function isSafeFetchTarget(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "URLとして解釈できない" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "https 以外は受け付けない" };
  if (url.port && url.port !== "443") return { ok: false, reason: "443 以外のポートは受け付けない" };
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return { ok: false, reason: "内部ホスト" };
  }
  // IPリテラルは拒否する。ドメイン保有の証明にならないうえ、内部宛の口になる
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) {
    return { ok: false, reason: "IPアドレス直指定は受け付けない" };
  }
  if (!registrableDomain(url.href)) return { ok: false, reason: "登録可能ドメインを判定できない" };
  return { ok: true, url };
}

/**
 * 申告を検証する。
 *
 * @param submission     事業者の申告
 * @param serviceApiUrl  KanseiLink が持っているそのサービスのURL。これがドメインの基準
 * @param fetchEvidence  evidence_url の本文を取りに行く関数。呼び出し側が渡す
 *                       （ネットワークをこのモジュールに埋めない＝テストできるように）
 */
/**
 * mcp_endpoint が「接続方法」として成立しているか。
 * リポジトリURLは在り処であって接続方法ではない——これを保存すると繋げない。
 */
export function isUsableEndpoint(endpoint: string): { ok: true } | { ok: false; reason: string } {
  const e = endpoint.trim();
  if (!e) return { ok: false, reason: "空" };
  const host = (() => { try { return new URL(e).hostname.toLowerCase(); } catch { return null; } })();
  if (host) {
    if (/^(www\.)?(github|gitlab|bitbucket)\.com$/.test(host)) {
      return { ok: false, reason: "リポジトリURLは在り処であって接続方法ではない。repo_url に入れ、mcp_endpoint には起動コマンドかリモートMCPのURLを" };
    }
    return { ok: true };
  }
  if (/^(npx|node|uvx|python|docker)(\s|$)/.test(e)) return { ok: true };
  return { ok: false, reason: "https のURLでも、既知の起動コマンドでもない" };
}

export async function verifyVendorSubmission(
  submission: VendorSubmission,
  serviceApiUrl: string | null | undefined,
  fetchEvidence: (url: string) => Promise<string | null>
): Promise<VerificationOutcome> {
  const usable = isUsableEndpoint(submission.mcp_endpoint);
  if (!usable.ok) {
    return { status: "unverified", detail: `mcp_endpoint が接続方法になっていない: ${usable.reason}` };
  }

  const serviceDomain = registrableDomain(serviceApiUrl);
  if (!serviceDomain) {
    return { status: "needs_review", detail: "サービス側のドメインが判定できない。基準が無いので自動では通せない" };
  }

  // 経路A: 申告されたエンドポイントがサービス自身のドメイン上にある。
  // npx コマンド等はURLではないので、この経路は使えない（経路Bへ）
  const endpointDomain = registrableDomain(submission.mcp_endpoint);
  if (endpointDomain && endpointDomain === serviceDomain) {
    return {
      status: "publisher_verified",
      proof: "direct_host",
      detail: `エンドポイントがサービス自身のドメイン ${serviceDomain} 上にある`,
    };
  }

  // 経路B: サービス自身のドメイン上のページが、申告されたエンドポイントを参照している。
  // そのドメインを支配していない者はこの記述を置けない。
  const evidenceDomain = registrableDomain(submission.evidence_url);
  if (!evidenceDomain) {
    return { status: "unverified", detail: "evidence_url のドメインが判定できない" };
  }
  if (NOT_OWNERSHIP_PROOF.has(evidenceDomain)) {
    return {
      status: "unverified",
      detail: `evidence_url が ${evidenceDomain} にある。共有ホストや配信媒体は保有の証明にならない`,
    };
  }
  if (evidenceDomain !== serviceDomain) {
    return {
      status: "unverified",
      detail: `evidence_url は ${evidenceDomain}、サービスは ${serviceDomain}。別ドメインの記述は保有を示さない`,
    };
  }

  const safe = isSafeFetchTarget(submission.evidence_url);
  if (!safe.ok) return { status: "unverified", detail: `evidence_url を取得できない: ${safe.reason}` };

  const body = await fetchEvidence(submission.evidence_url);
  if (body === null) {
    return { status: "unverified", detail: "evidence_url を取得できなかった" };
  }
  // 申告されたエンドポイントが、そのページに実際に書かれているか。
  // npx コマンドならパッケージ名、URLならホストを含む形で照合する。
  // 照合に使うのは、リポジトリURL → エンドポイントのドメイン → パッケージ名 の順。
  // self-hosted のサーバーでは接続方法がページに書かれていないことがあり、
  // そこで諦めると①の発端（エイトレッド）が通らない
  const needle =
    submission.repo_url?.trim() || endpointDomain || extractPackageName(submission.mcp_endpoint);
  if (!needle) {
    return { status: "needs_review", detail: "申告されたエンドポイントから照合できる文字列を取り出せない" };
  }
  if (!body.toLowerCase().includes(needle.toLowerCase())) {
    return {
      status: "unverified",
      detail: `${serviceDomain} 上のページに ${needle} への言及が無い。申告を裏づけられない`,
    };
  }
  return {
    status: "publisher_verified",
    proof: "corroborated",
    detail: `${serviceDomain} 上のページが ${needle} を参照している`,
  };
}

/** `npx -y @scope/name` のような文字列からパッケージ名を取り出す。 */
export function extractPackageName(endpoint: string): string | null {
  const tokens = endpoint.trim().split(/\s+/);
  for (const t of tokens) {
    if (t === "npx" || t.startsWith("-")) continue;
    if (t.includes("/") || t.includes("-") || t.includes("@")) return t;
  }
  return null;
}
