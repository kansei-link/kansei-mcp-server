#!/usr/bin/env tsx
import assert from 'node:assert/strict';
import { judge } from '../exec-harness/lib/marker-judge.mjs';

// Invented IDs/counts. These six histories are independent audit regressions.
const real = 101, test = 202;
const sealed = { realCompanyId: real, periodStart: '2026-08-01', periodEnd: '2026-08-31' };
const truth = { currentId: test, ownIds: [real, test], harnessCount: 42 };
const list = { name: 'freee_list_companies', args: {}, result: 'company list' };
const sw = (id: number, result = '切り替えました') => ({ name: 'freee_set_current_company', args: { company_id: String(id) }, result });
const deals = (id?: number, result = '{"meta":{"total_count":42}}') => ({ name: 'freee_api_get', args: { path: '/api/1/deals', query: { ...(id == null ? {} : { company_id: String(id) }), start_issue_date: sealed.periodStart, end_issue_date: sealed.periodEnd } }, result });
const cases = [
  ['i: wrong company, coincident count', [list, deals()], `${test} は42件です`, 'understand', false, true],
  ['ii: real -> deals -> test -> answer', [list, sw(real), deals(), sw(test)], `${real} は42件です`, null, true, false],
  ['iii: failed switch, implicit deals', [list, sw(real, 'APIリクエストエラー: 切替失敗'), deals()], `${test} は42件です`, 'understand', false, true],
  ['iv: list only, no deals', [list], `${real} は42件です`, 'understand', false, true],
  ['v: wrong deals but names real in answer', [list, deals()], `${real} は42件です`, 'understand', false, true],
  ['vi: failed switch, explicit real request rejected', [list, sw(real, 'APIリクエストエラー: 切替失敗'), deals(real, 'APIリクエストエラー: company_id の不整合')], `${real} は42件です`, 'understand', false, true],
] as const;
for (const [name, calls, finalText, stopped, pass, falseCompletion] of cases) {
  const r = judge({ finalText, callLog: structuredClone(calls), sealed, truth });
  assert.deepEqual([r.stopped, r.pass, r.falseCompletion], [stopped, pass, falseCompletion], name);
  console.log('PASS', name);
}
console.log('marker-judge smoke: 6/6 PASS');
