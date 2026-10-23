/**
 * vendor_official — 「提供元（SaaS 会社）の公式 MCP」の判定。ここ 1 か所だけで決める。
 *
 * `mcp_status = 'official'` は 1,995 件あるが、その大半は MCP Registry から入った個人・小規模の
 * サーバーで、「提供元が出している」ことを意味しない（2026-10-07 Winter 調査でも母集団にできないと記録）。
 * 次の 3 つを全部満たす物だけを vendor_official とする（seed で 58 件・2026-10-23）:
 *   1. mcp_status = 'official'
 *   2. id が Registry の名前空間の形ではない（namespace "com.korture" → id "com-korture-…" のような物、
 *      または id が io-github-／com-／ai-／app-／dev-／co-／eu-／net-／org-／io- で始まる物を除く）
 *   3. api_url があり、github.com／npmjs.com／gitlab.com／pypi.org ではない
 *      （＝提供元のドメインに API 文書がある）
 */
export interface VendorOfficialInput {
  id: string;
  mcp_status?: string | null;
  namespace?: string | null;
  api_url?: string | null;
}

const REGISTRY_ID_PREFIX = /^(io-github|io|com|ai|app|dev|co|eu|net|org)-[a-z0-9]/;
const CODE_HOST_URL = /^https?:\/\/(www\.)?(github\.com|npmjs\.com|gitlab\.com|pypi\.org)(\/|$)/i;

const slug = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** True when the id was derived from an MCP Registry namespace (reverse-DNS) rather than curated. */
export function hasRegistryShapedId(row: Pick<VendorOfficialInput, "id" | "namespace">): boolean {
  const id = row.id.toLowerCase();
  if (REGISTRY_ID_PREFIX.test(id)) return true;
  const ns = (row.namespace ?? "").split("/")[0];
  if (!ns || !ns.includes(".")) return false;
  const s = slug(ns);
  return id === s || id.startsWith(`${s}-`);
}

export function isVendorOfficial(row: VendorOfficialInput): boolean {
  if (row.mcp_status !== "official") return false;
  if (hasRegistryShapedId(row)) return false;
  const api = (row.api_url ?? "").trim();
  if (!api || CODE_HOST_URL.test(api)) return false;
  return true;
}
