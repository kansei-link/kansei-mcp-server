#!/usr/bin/env node
/**
 * check-profiles.mjs — 独立Checker（Qレーン: kl-integrity）
 *
 * 検査対象: growth-mvp/profile-drafts/*.html（全項目）+ growth-mvp/install-drafts/*.html（score/rank・provenance語のみ）
 * 検査基準（正典から独立に導出。Makerパイプライン実装は参照していない）:
 *   - founder-ops/PLAN-Profile-Claim-MVP-v1.md §1（公開原則）§3（項目定義・Checkerチェックリスト）§4.0（3概念分離）§5（バッジ文言）
 *   - founder-ops/FUNNEL-METRICS-v1.md §3 品質guardrail（provenance禁止語0・R-005違反0・「未確認」表示の欠落0）
 *
 * 検査は「可視テキスト」（HTMLコメント・script・styleを除外した描画テキスト）に対して行う。
 * ただし provenance 禁止語のみ、公開ソース全体（view-sourceで読める部分）にも追加スキャンする。
 *
 * 出力: ファイル別JSON + サマリ。error（=公開ブロック）が1件でもあれば exit 1。warn は exit code に影響しない。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 環境変数での差し替えはChecker自身のself-test（seeded violations検出能力の証明）用
const PROFILE_DIR = process.env.CHECK_PROFILE_DIR || path.join(root, 'growth-mvp', 'profile-drafts');
const INSTALL_DIR = process.env.CHECK_INSTALL_DIR || path.join(root, 'growth-mvp', 'install-drafts');
const MANIFEST = path.join(PROFILE_DIR, 'manifest.json');

/* ---------- 可視テキスト抽出（インデックス保存型） ---------- */
// マッチ位置から元ファイルの行番号を出せるよう、除去部分は同じ長さの空白に置換する（改行は保持）。
const blank = (s, re) => s.replace(re, (m) => m.replace(/[^\n]/g, ' '));

function visibleLayer(raw) {
  let s = blank(raw, /<!--[\s\S]*?-->/g);          // HTMLコメント除外
  s = blank(s, /<script\b[\s\S]*?<\/script\s*>/gi); // script（JSON-LD含む）除外
  s = blank(s, /<style\b[\s\S]*?<\/style\s*>/gi);   // style除外
  s = blank(s, /<[^>]*>/g);                         // タグ自体を除外（属性値=非可視テキストも消える）
  return s;
}

// タグ構造は残しつつコメント/script/styleだけ除去した層（行構造の検査用）
function structLayer(raw) {
  let s = blank(raw, /<!--[\s\S]*?-->/g);
  s = blank(s, /<script\b[\s\S]*?<\/script\s*>/gi);
  s = blank(s, /<style\b[\s\S]*?<\/style\s*>/gi);
  return s;
}

const lineOf = (s, idx) => s.slice(0, idx).split('\n').length;
const excerptAt = (s, idx, span = 40) =>
  s.slice(Math.max(0, idx - span), idx + span).replace(/\s+/g, ' ').trim();

function scan(layer, re, cb) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(layer)) !== null) {
    cb(m);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
}

const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- 検査項目 ---------- */

function makeFinding(check, severity, line, excerpt, message) {
  return { check, severity, line, excerpt, message };
}

// C1: R-005 — 実名サービスへの成功率・数値評価の表示 0件
function checkR005(vis, findings) {
  const patterns = [
    { re: /成功率/g, why: '「成功率」の語が可視テキストに出現' },
    { re: /\d+(?:\.\d+)?\s*[%％]/g, why: 'パーセント数値の表示（R-005: 個社数値公開禁止）' },
    { re: /(成功|失敗|接続|完了|到達)率\s*[:：]?\s*\d/g, why: '率+数値の組み合わせ' },
  ];
  for (const p of patterns) {
    scan(vis, p.re, (m) =>
      findings.push(makeFinding('C1_R005', 'error', lineOf(vis, m.index), excerptAt(vis, m.index), p.why)),
    );
  }
}

// C2: ARI個別スコア・順位・点数の非表示（段階バッジ AAA/AA/A/BBB/BB は許容）
function checkScoreRank(vis, findings) {
  const hard = [
    { re: /\d+点/g, why: '点数の数値表示' },
    { re: /点満点/g, why: '満点表記（スコア存在の示唆）' },
    { re: /スコア\s*[:：]?\s*\d+/g, why: 'スコア数値の表示' },
    { re: /\d+\s*位/g, why: '順位の数値表示' },
    { re: /ランキング\s*\d+/g, why: 'ランキング順位の表示' },
    { re: /順位\s*[:：]\s*\d+/g, why: '順位数値の表示' },
    { re: /第\s*\d+\s*位/g, why: '順位の数値表示' },
  ];
  for (const p of hard) {
    scan(vis, p.re, (m) =>
      findings.push(makeFinding('C2_score_rank', 'error', lineOf(vis, m.index), excerptAt(vis, m.index), p.why)),
    );
  }
  // 数値を伴わない「順位」「ランキング」の語は違反とはしないが、人間レビュー用に警告として報告する
  scan(vis, /順位|ランキング/g, (m) => {
    const around = vis.slice(Math.max(0, m.index - 30), m.index + 30);
    if (/順位\s*[:：]?\s*\d|\d\s*位|ランキング\s*\d/.test(around)) return; // hard側で検出済み
    findings.push(
      makeFinding('C2_score_rank', 'warn', lineOf(vis, m.index), excerptAt(vis, m.index),
        '数値を伴わない「順位/ランキング」の語（免責文脈なら許容・要目視確認）'),
    );
  });
}

// C3: 断定否定表現 0件（「未確認」文脈は許容→warn降格）
function checkNegative(vis, findings) {
  const re = /使えない|使えません|接続できない|接続できません|非対応|非推奨|対応していません|利用できません|動作しません|動きません|サポートされていません|サポート対象外|推奨しません/g;
  scan(vis, re, (m) => {
    const sentence = vis.slice(Math.max(0, m.index - 60), m.index + 60);
    const softened = /未確認|検証予定|未検証/.test(sentence);
    findings.push(
      makeFinding('C3_negative', softened ? 'warn' : 'error', lineOf(vis, m.index), excerptAt(vis, m.index),
        softened ? '否定表現だが「未確認」文脈内（要目視確認）' : '断定的な否定表現（公開原則§1-2違反）'),
    );
  });
}

// C4: provenance禁止語 0件（可視テキスト=error。公開ソース全体にもスキャン=error: view-sourceで読めるため）
function checkProvenance(vis, raw, findings) {
  const re = /synthetic|legacy_unknown|kansei_probe/gi;
  scan(vis, re, (m) =>
    findings.push(makeFinding('C4_provenance', 'error', lineOf(vis, m.index), excerptAt(vis, m.index),
      `provenance禁止語「${m[0]}」が可視テキストに出現（Data Architecture §3）`)),
  );
  // 非可視部（コメント/script等）への混入も公開ファイルとしては不可とみなす
  scan(raw, re, (m) => {
    if (vis[m.index] !== ' ' || /synthetic|legacy_unknown|kansei_probe/i.test(vis.slice(m.index, m.index + 20))) return; // 可視側で検出済みの重複回避
    findings.push(makeFinding('C4_provenance_source', 'error', lineOf(raw, m.index), excerptAt(raw, m.index),
      `provenance禁止語「${m[0]}」が非可視部（コメント/script）に混入——view-sourceで公開される`));
  });
}

// C5: Claimed / Verified 表示 0件（手動承認前）。Evidence Tier表示名もMVPドラフトでは未実測なので出ないはず
function checkClaimedVerified(vis, raw, findings) {
  const strict = [
    { re: /Claimed/g, why: '「Claimed」表示（Michie L3手動承認前は表示禁止・§4.0）' },
    { re: /Company\s+Representative\s+Verified/gi, why: '「Company Representative Verified」は公開表示しない定義（§4.0）' },
  ];
  for (const p of strict) {
    scan(vis, p.re, (m) =>
      findings.push(makeFinding('C5_claim_verified', 'error', lineOf(vis, m.index), excerptAt(vis, m.index), p.why)),
    );
  }
  // Evidence Tier表示名（Tested/Reproduced/Public Verified/Monitored）: 定義上の語だがE0のみのMVPドラフトに出るのは不整合
  const tierNames = /Public\s+Verified|\bTested\b|\bReproduced\b|\bMonitored\b/g;
  scan(vis, tierNames, (m) =>
    findings.push(makeFinding('C5_claim_verified', 'error', lineOf(vis, m.index), excerptAt(vis, m.index),
      `Evidence Tier表示名「${m[0].replace(/\s+/g, ' ')}」——全社E0のMVPドラフトに出現するのは実測裏付けなしの表示`)),
  );
  // その他の「Verified」: 未確認リスト内の用語参照（例:「接続実測（Connection Verified）の実施と検証日」）のみ許容
  const unverifiedRanges = [];
  scan(raw, /<ul\s+class="unverified-list">[\s\S]*?<\/ul>/g, (m) =>
    unverifiedRanges.push([m.index, m.index + m[0].length]),
  );
  scan(vis, /\bVerified\b/g, (m) => {
    if (/Company\s+Representative\s+$/.test(vis.slice(Math.max(0, m.index - 40), m.index))) return;
    if (/Public\s+$/.test(vis.slice(Math.max(0, m.index - 10), m.index))) return;
    const inUnverified = unverifiedRanges.some(([a, b]) => m.index >= a && m.index < b);
    const sentence = vis.slice(Math.max(0, m.index - 60), m.index + 60);
    const asPlanned = /未確認|検証予定|実施(前|予定)/.test(sentence);
    if (inUnverified || asPlanned) {
      findings.push(makeFinding('C5_claim_verified', 'warn', lineOf(vis, m.index), excerptAt(vis, m.index),
        '「Verified」の語が未確認/検証予定文脈で用語参照として出現（許容・要目視確認）'));
    } else {
      findings.push(makeFinding('C5_claim_verified', 'error', lineOf(vis, m.index), excerptAt(vis, m.index),
        '「Verified」表示に実測裏付けの文脈がない（§5: VerifiedはEvidence Tier系に予約）'));
    }
  });
}

// C6: last_verified規律 — 事実として表示される行に最終検証日が併記されている
const DATE_RE = /最終検証日\s*[:：]\s*\d{4}-\d{2}-\d{2}/;
function checkLastVerified(struct, findings) {
  scan(struct, /<tr>[\s\S]*?<\/tr>/g, (m) => {
    const row = m[0];
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => stripTags(c[1]));
    if (cells.length < 2) return;
    const label = cells[0];
    const value = cells[1];
    const lv = cells[cells.length - 1];
    if (!value) return;
    const isUnverified = /未確認/.test(value);
    const isPending = /準備中|検証予定|順次実施/.test(value);
    const hasDate = DATE_RE.test(lv) || DATE_RE.test(value);
    if (isUnverified) {
      if (hasDate) {
        findings.push(makeFinding('C6_last_verified', 'error', lineOf(struct, m.index), `${label}: ${value}`,
          '「未確認」表示に検証日が併記されている（矛盾——未確認は検証日を持たない）'));
      }
      return;
    }
    if (isPending) {
      findings.push(makeFinding('C6_last_verified', 'warn', lineOf(struct, m.index), `${label}: ${value}`,
        '予定/状態記述の行（事実ではないため検証日なしを許容と解釈——§1-4の解釈揺れ・レポート参照）'));
      return;
    }
    if (!hasDate) {
      findings.push(makeFinding('C6_last_verified', 'error', lineOf(struct, m.index), `${label}: ${value}`,
        '検証済み事実として表示される行に最終検証日がない（公開原則§1-4違反）'));
    }
  });
  // ARIバッジ（grade-badge）にも検証日が必要
  scan(struct, /<div\s+class="grade-badge">[\s\S]*?<\/div>\s*<\/div>/g, (m) => {
    if (!DATE_RE.test(m[0])) {
      findings.push(makeFinding('C6_last_verified', 'error', lineOf(struct, m.index), stripTags(m[0]).slice(0, 60),
        'ARI段階バッジに最終検証日が併記されていない'));
    }
  });
}

// C7: 未確認セクションの存在
function checkUnverifiedSection(struct, findings) {
  if (!/<h2[^>]*>[^<]*未確認/.test(struct)) {
    findings.push(makeFinding('C7_unverified_section', 'error', 0, '',
      '「未確認の項目」セクションが存在しない（§3 未確認欄・guardrail「未確認表示の欠落0」）'));
  }
}

// C8: フッター文言（検証済み事実/未確認項目の区別・最終検証日併記の説明）
function checkFooter(struct, findings) {
  const m = struct.match(/<footer>[\s\S]*?<\/footer>/);
  if (!m) {
    findings.push(makeFinding('C8_footer', 'error', 0, '', 'フッターが存在しない'));
    return;
  }
  const text = stripTags(m[0]);
  if (!/検証済み事実と未確認項目を区別/.test(text)) {
    findings.push(makeFinding('C8_footer', 'error', lineOf(struct, m.index), text.slice(0, 80),
      'フッターに「検証済み事実と未確認項目を区別」の説明文言がない'));
  }
  if (!/最終検証日を併記/.test(text)) {
    findings.push(makeFinding('C8_footer', 'error', lineOf(struct, m.index), text.slice(0, 80),
      'フッターに「最終検証日を併記」の説明文言がない'));
  }
}

// C9: manifestのseed_match（unverified_not_rendered）がHTML可視面に漏れていないか
function checkSeedLeak(vis, raw, seedMatch, findings) {
  if (!seedMatch) return;
  const needles = [seedMatch.api_url_candidate, seedMatch.id].filter(Boolean);
  for (const n of needles) {
    let idx = vis.indexOf(n);
    if (idx !== -1) {
      findings.push(makeFinding('C9_seed_leak', 'error', lineOf(vis, idx), excerptAt(vis, idx),
        `未検証seed候補データ「${n}」が可視テキストに描画されている（rev2④: 未検証vendor系は一切公開しない）`));
      continue;
    }
    idx = raw.indexOf(n);
    if (idx !== -1) {
      findings.push(makeFinding('C9_seed_leak', 'warn', lineOf(raw, idx), excerptAt(raw, idx),
        `未検証seed候補データ「${n}」が非可視部（HTMLコメント等）に存在——描画はされないがview-sourceで公開される（レポートの指摘参照）`));
    }
  }
}

/* ---------- 実行 ---------- */

function auditFile(filePath, { full, seedMatch }) {
  const raw = readFileSync(filePath, 'utf8');
  const vis = visibleLayer(raw);
  const struct = structLayer(raw);
  const findings = [];
  checkScoreRank(vis, findings);
  checkProvenance(vis, raw, findings);
  if (full) {
    checkR005(vis, findings);
    checkNegative(vis, findings);
    checkClaimedVerified(vis, raw, findings);
    checkLastVerified(struct, findings);
    checkUnverifiedSection(struct, findings);
    checkFooter(struct, findings);
    checkSeedLeak(vis, raw, seedMatch, findings);
  }
  return findings;
}

function main() {
  const results = [];
  let manifest = null;
  const manifestFindings = [];

  if (existsSync(MANIFEST)) {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const htmlFiles = readdirSync(PROFILE_DIR).filter((f) => f.endsWith('.html'));
    if (manifest.count !== manifest.profiles.length) {
      manifestFindings.push(makeFinding('M1_manifest', 'error', 0, '', `manifest.count=${manifest.count} と profiles配列長=${manifest.profiles.length} が不一致`));
    }
    if (manifest.profiles.length !== htmlFiles.length) {
      manifestFindings.push(makeFinding('M1_manifest', 'error', 0, '', `manifest件数${manifest.profiles.length}と実ファイル数${htmlFiles.length}が不一致`));
    }
    for (const p of manifest.profiles) {
      if (p.seed_match && p.seed_match.status !== 'unverified_not_rendered') {
        manifestFindings.push(makeFinding('M2_seed_status', 'error', 0, p.slug, `seed_match.status=「${p.seed_match.status}」——未検証データの扱いが不明（unverified_not_renderedのみ許容と解釈）`));
      }
      if (p.evidence_tier !== 'E0') {
        manifestFindings.push(makeFinding('M3_tier', 'warn', 0, p.slug, `evidence_tier=${p.evidence_tier}——E0以外は実測結合前のMVPでは想定外（要確認）`));
      }
    }
  } else {
    manifestFindings.push(makeFinding('M1_manifest', 'error', 0, '', 'manifest.json が存在しない'));
  }

  const seedBySlug = new Map((manifest?.profiles ?? []).map((p) => [p.file, p.seed_match ?? null]));

  for (const f of readdirSync(PROFILE_DIR).filter((f) => f.endsWith('.html')).sort()) {
    const fp = path.join(PROFILE_DIR, f);
    results.push({ file: `profile-drafts/${f}`, findings: auditFile(fp, { full: true, seedMatch: seedBySlug.get(f) ?? null }) });
  }
  if (existsSync(INSTALL_DIR)) {
    for (const f of readdirSync(INSTALL_DIR).filter((f) => f.endsWith('.html')).sort()) {
      const fp = path.join(INSTALL_DIR, f);
      results.push({ file: `install-drafts/${f}`, findings: auditFile(fp, { full: false, seedMatch: null }) });
    }
  }
  if (manifestFindings.length) results.push({ file: 'profile-drafts/manifest.json', findings: manifestFindings });

  const errors = results.flatMap((r) => r.findings.filter((x) => x.severity === 'error').map((x) => ({ file: r.file, ...x })));
  const warns = results.flatMap((r) => r.findings.filter((x) => x.severity === 'warn').map((x) => ({ file: r.file, ...x })));

  const summary = {
    checked_files: results.length,
    errors: errors.length,
    warnings: warns.length,
    verdict: errors.length === 0 ? 'PASS（公開ブロック該当なし）' : 'FAIL（公開ブロック——errorを修正しMakerへ差し戻し）',
    by_check: {},
  };
  for (const r of results) {
    for (const x of r.findings) {
      summary.by_check[x.check] = summary.by_check[x.check] || { error: 0, warn: 0 };
      summary.by_check[x.check][x.severity]++;
    }
  }

  console.log(JSON.stringify({ generated_at: new Date().toISOString(), role: 'Checker (kl-integrity, 独立検査)', summary, results }, null, 2));
  process.exit(errors.length === 0 ? 0 : 1);
}

main();
