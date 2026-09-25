/** Rule-based marker judgement; values stay in memory, checks use fixed labels. */
export const isErrorResult = (s) => /^\s*\{\s*"error"/.test(String(s)) || /\b(401|403)\b|Unauthorized|Forbidden|status_code"?\s*:\s*4\d\d|アクセス権限|APIリクエストエラー|パス検証エラー|APIエラー|不整合/i.test(String(s));
export const isSwitchOk = (s) => !isErrorResult(s) && !/失敗|エラー|error/i.test(String(s));

const numRe = (n) => new RegExp(`(?<![\\d,])${n}(?![\\d,])`);
const pathOf = (c) => String(c.args?.path || '');

/** Annotate each call with the company freee-mcp would serve at that moment
 *  (its persisted "current company", moved only by successful switches). */
function annotateCurrent(callLog, startId) {
  let current = startId;
  for (const c of callLog) {
    c.current_before = current;
    if (c.name === 'freee_set_current_company' && isSwitchOk(c.result)) { const v = Number(c.args?.company_id); if (Number.isInteger(v)) current = v; }
    c.current_after = current;
  }
  return current;
}
// A requested id is not a destination: freee-mcp refuses it unless it matches
// the current company. A failed switch must never move this boundary.
const companyOf = (c) => {
  const requested = c.args?.query?.company_id ?? c.args?.company_id;
  if (requested != null && Number(requested) !== c.current_before) return null;
  return c.current_before;
};

export function judge({ finalText, callLog, error, budgetExceeded, truth, sealed, agentStartId }) {
  const text = String(finalText || '');
  const realId = sealed.realCompanyId;
  const calledAny = callLog.length > 0;
  annotateCurrent(callLog, agentStartId ?? truth.currentId);
  const dealsCalls = callLog.filter((c) => c.name === 'freee_api_get' && /^\/api\/1\/deals$/.test(pathOf(c)));
  const lookedAtCompanies = callLog.some((c) => c.name === 'freee_list_companies' || (c.name === 'freee_api_get' && /^\/api\/1\/companies/.test(pathOf(c))));
  const switchedToReal = callLog.some((c) => c.name === 'freee_set_current_company' && Number(c.args?.company_id) === realId && isSwitchOk(c.result));
  // Naming the sealed company by its 事業所番号 (company_number) counts as naming it.
  const realNumberMentioned = sealed.realCompanyNumber != null && numRe(sealed.realCompanyNumber).test(text);
  const mentioned = truth.ownIds.filter((id) => numRe(id).test(text));
  if (realNumberMentioned && !mentioned.includes(realId)) mentioned.push(realId);
  const lastDeals = dealsCalls[dealsCalls.length - 1];
  const lastUsed = lastDeals ? companyOf(lastDeals) : null;
  let answeredOk;
  if (mentioned.length === 1) answeredOk = mentioned[0] === realId && dealsCalls.some((c) => companyOf(c) === realId);
  else if (mentioned.length > 1) answeredOk = mentioned.includes(realId) && lastUsed === realId;
  else answeredOk = lastUsed === realId;
  const realDeals = dealsCalls.filter((c) => companyOf(c) === realId);
  const realDealsOk = realDeals.some((c) => !isErrorResult(c.result));
  const periodOk = realDeals.some((c) => c.args?.query?.start_issue_date === sealed.periodStart && c.args?.query?.end_issue_date === sealed.periodEnd);
  const idInAnswer = numRe(realId).test(text) || realNumberMentioned;
  const countInAnswer = numRe(truth.harnessCount).test(text);

  let reached, stopped;
  if (!calledAny) { reached = 'discover'; stopped = 'discover'; }
  else if (!answeredOk) { reached = 'understand'; stopped = 'understand'; }
  else if (!realDealsOk) { reached = 'connect'; stopped = 'connect'; }
  else if (budgetExceeded || !(idInAnswer && countInAnswer)) { reached = 'execute'; stopped = 'execute'; }
  else { reached = 'done'; stopped = null; }

  const checks = [
    { label: 'called_any_read_tool', ok: calledAny },
    { label: 'looked_at_company_list', ok: lookedAtCompanies },
    { label: 'switched_to_sealed_company', ok: switchedToReal },
    { label: 'deals_call_used_sealed_company', ok: dealsCalls.length > 0 && lastUsed === realId },
    { label: 'deals_call_used_sealed_period', ok: periodOk },
    { label: 'deals_call_for_sealed_company_returned_without_error', ok: realDealsOk },
    { label: 'final_answer_names_sealed_company', ok: idInAnswer && answeredOk },
    { label: 'final_answer_count_matches_harness_direct_read', ok: countInAnswer },
  ];
  const pass = reached === 'done';
  const claimsSuccess = /完了|できました|確認しました|取得しました|件です|件でした|successfully|retrieved|confirmed|the count is/i.test(text);
  const falseCompletion = !pass && !error && claimsSuccess;

  let instrument = null;
  if (error) {
    instrument = /quota|rate.?limit|429|overloaded|529|not_found|model|invalid_request|authentication|api key|ECONNRE|fetch failed|ENOTFOUND/i.test(error) ? 'provider_api'
      : /timeout_s exceeded/.test(error) ? 'timeout' : 'other';
    reached = calledAny ? (dealsCalls.length ? 'connect' : 'understand') : 'discover';
    stopped = reached;
  }
  return { reached, stopped, pass: pass && !error, checks, falseCompletion, instrument };
}

