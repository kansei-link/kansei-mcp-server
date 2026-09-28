/**
 * ATTRIBUTION-Rules v0.1 (founder-ops/ATTRIBUTION-Rules-v0_2026-09-28.md §2, §2-1, §3) — organ 1
 * (discover, the REPO line) for M-004. A REPORT-layer interpretation, never a ledger fact: the
 * ledger holds three observations per run (A and B as ground-truth side rows, C as the agent
 * reading); this module only reads them and names whose hole it is, under the label
 * 「判断（規則 v0.1）」. Pure functions, no I/O and NO IMPORTS: marker-persist.mjs and
 * render-reading-sheet.mjs load this file, so every marker (M-001, M-002, …) depends on it at start-up;
 * it must never pull in the source-reading parts (attribution-rules.mjs, the vendored decoder).
 *
 * Truth table (A = listed on the official pages, B = KanseiLINK catalog correct, C = AI passed):
 *   #1 A B C  穴なし            #5 ¬A B C  会社側の公開の穴（AI は別経路で到達）
 *   #2 A B ¬C AI 側             #6 ¬A B ¬C 会社側: 公式情報に MCP の所在が無い
 *   #3 A ¬B C KanseiLINK 側      #7 ¬A ¬B C 会社側と KanseiLINK 側の穴が併存（AI は別経路で到達）
 *   #4 A ¬B ¬C AI 側、KanseiLINK 側が併存   #8 ¬A ¬B ¬C 会社側と KanseiLINK 側の穴が併存
 * Undetermined (no judgement is printed, only the label):
 *   U0 ground truth moved (renamed / moved / archived / not public)  → 未確定（計器）; C is not counted as a miss
 *   U1 A unknown: not received completely, or a name present that does not resolve, or no A row → 未確定（計器）
 *   U2 B unknown: the item unobservable, or a field naming the repo that does not resolve, or no B row → 未確定（計器）
 *   U4 the AI reading itself is an instrument error                   → 未確定（計器）
 *   U3 the AI answer violated the two-line form                       → 未確定（回答形式）
 * Precedence: U0 > U1 > U2 > U4 > U3 > #1–#8.
 */

export const RULES_LABEL = '規則 v0.1';
export const ATTR_METHODS = Object.freeze({ A: 'sealed_repo_vs_official_docs', B: 'sealed_repo_vs_kansei_catalog' });
export const AGENT_METHOD = 'llm_answer_rules_vs_sealed_expectation';

const check = (o, label) => (o?.checks || []).find((c) => c.label === label);

/** Ground-truth side label used by the README rows and the sheet's ground-truth table. */
export function gtLabel(o) {
  if (o.method === ATTR_METHODS.A) return o.pass ? 'A 公式情報: 載っている' : o.instrument_error ? 'A 公式情報: 判定不能' : 'A 公式情報: 載っていない';
  if (o.method === ATTR_METHODS.B) return o.pass ? 'B KanseiLINK: 正しい' : o.instrument_error ? 'B KanseiLINK: 判定不能' : 'B KanseiLINK: 誤り';
  return o.pass ? '一致' : '不一致';
}

/** Column A from its ground-truth row (or undefined). state: listed | not_listed | unknown. */
export function columnA(obs) {
  if (!obs) return { state: 'unknown', text: '記録なし' };
  const ids = (obs.checks || []).map((c) => /^(A\d+)_page_lists_sealed_repo$/.exec(c.label)?.[1]).filter(Boolean);
  // per page: あり (resolves) / なし (received completely, names absent) / 判定不能 (a name that does not resolve) / 取得失敗
  const page = (id) => check(obs, `${id}_page_lists_sealed_repo`)?.ok ? 'あり' : !check(obs, `${id}_page_fetched`)?.ok ? '取得失敗' : check(obs, `${id}_page_names_absent`)?.ok === false ? '判定不能' : 'なし';
  const detail = ids.map((id) => `${id} ${page(id)}`).join('・');
  const tail = detail ? `（${detail}）` : '';
  if (!obs.pass && obs.instrument_error) return { state: 'unknown', text: `判定不能${tail}` };
  return obs.pass ? { state: 'listed', text: `載っている${tail}`, a1: check(obs, 'A1_page_lists_sealed_repo')?.ok === true } : { state: 'not_listed', text: `載っていない${tail}` };
}

/** Column B from its ground-truth row (or undefined). state: correct | wrong | unknown. */
export function columnB(obs) {
  if (!obs) return { state: 'unknown', text: '記録なし' };
  const fields = (obs.checks || []).map((c) => /^catalog_field_lists_sealed_repo:(.+)$/.exec(c.label)?.[1]).filter(Boolean);
  const unresolved = (obs.checks || []).map((c) => /^catalog_field_names_sealed_repo_unresolved:(.+)$/.exec(c.label)?.[1]).filter(Boolean);
  if (!obs.pass && obs.instrument_error) return { state: 'unknown', text: unresolved.length ? `判定不能（名前はあるがリンクとして解けない欄: ${unresolved.join(', ')}）` : '判定不能（観測できない）' };
  if (obs.pass) return { state: 'correct', text: `正しい（欄: ${fields.join(', ') || '—'}）` };
  return { state: 'wrong', text: check(obs, 'catalog_item_present')?.ok === false ? '誤り（項なし）' : '誤り（欠落）' };
}

/** Column C = the AI reading's REPO line. state: pass | miss | format | instrument. */
export function columnC(obs) {
  if (obs.instrument_error) return { state: 'instrument', text: `計器:${obs.instrument_error}` };
  if (check(obs, 'answer_region_in_form')?.ok === false) return { state: 'format', text: '形式違反' };
  if (check(obs, 'repo_value_equals_sealed_repo')?.ok === true) return { state: 'pass', text: '通過' };
  if (check(obs, 'repo_value_is_not_none')?.ok === false) return { state: 'miss', text: '外した（none）' };
  return { state: 'miss', text: '外した（別 URL）' };
}

const TABLE = {
  'TTT': ['#1', '穴なし'],
  'TTF': ['#2', 'AI 側: 公式にも KanseiLINK にも載っているのに届いていない'],
  'TFT': ['#3', 'KanseiLINK 側の穴（AI は KanseiLINK 以外から到達）'],
  'TFF': ['#4', 'AI 側、かつ KanseiLINK 側の穴が併存'],
  'FTT': ['#5', '会社側の公開の穴（AI は別経路で到達）'],
  'FTF': ['#6', '会社側: 公式情報に MCP の所在が無い'],
  'FFT': ['#7', '会社側と KanseiLINK 側の穴が併存（AI は別経路で到達）'],
  'FFF': ['#8', '会社側と KanseiLINK 側の穴が併存'],
};

/** The day's judgement for one observer. gtConsistent: the agent row's ground_truth_consistent. */
export function judgeAttribution({ a, b, c, gtConsistent }) {
  if (gtConsistent === false) return { code: 'U0', text: '未確定（計器）', counted: false };
  if (a.state === 'unknown') return { code: 'U1', text: '未確定（計器）', counted: true };
  if (b.state === 'unknown') return { code: 'U2', text: '未確定（計器）', counted: true };
  if (c.state === 'instrument') return { code: 'U4', text: '未確定（計器）', counted: true };
  if (c.state === 'format') return { code: 'U3', text: '未確定（回答形式）', counted: true };
  const [code, text] = TABLE[`${a.state === 'listed' ? 'T' : 'F'}${b.state === 'correct' ? 'T' : 'F'}${c.state === 'pass' ? 'T' : 'F'}`];
  return { code, text: `${code} ${text}`, counted: true };
}

/**
 * One line per agent reading of a run that carries attribution rows. rows = effective ledger rows
 * (renderer shape: outcome_id, observed, evidence_ref, observed_at). Rows are joined by their
 * Evidence Bundle (the part of evidence_ref before '#'), so A/B always belong to the same run.
 * Returns [] when the marker has no attribution rows at all.
 */
export function attributionLines(rows) {
  const bundleOf = (r) => String(r.evidence_ref).split('#')[0];
  const attr = rows.filter((r) => r.outcome_id == null && Object.values(ATTR_METHODS).includes(r.observed.method));
  if (!attr.length) return [];
  const byBundle = new Map();
  for (const r of attr) { const k = bundleOf(r); if (!byBundle.has(k)) byBundle.set(k, {}); byBundle.get(k)[r.observed.method] = r.observed; }
  const out = [];
  for (const r of rows.filter((x) => x.outcome_id != null && x.observed.method === AGENT_METHOD)) {
    const cols = byBundle.get(bundleOf(r)) || {};
    const a = columnA(cols[ATTR_METHODS.A]), b = columnB(cols[ATTR_METHODS.B]), c = columnC(r.observed);
    const j = judgeAttribution({ a, b, c, gtConsistent: r.observed.ground_truth_consistent });
    out.push({ row: r, a, b, c: j.counted ? c : { ...c, text: `${c.text}（正解側のずれ・数えない）` }, judgement: j });
  }
  return out;
}
