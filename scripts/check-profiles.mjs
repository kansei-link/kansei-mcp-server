#!/usr/bin/env node
/**
 * check-profiles.mjs — 独立Checker（Qレーン: kl-integrity）rev2
 *
 * 検査対象: growth-mvp/profile-drafts/*.html（全項目）+ growth-mvp/install-drafts/*.html（score/rank・provenance語・source-leak）
 * 検査基準（正典から独立に導出。Makerパイプライン実装は参照していない）:
 *   - founder-ops/PLAN-Profile-Claim-MVP-v1.md §1（公開原則）§3（項目定義・Checkerチェックリスト）§4.0（3概念分離）§5（バッジ文言）
 *   - founder-ops/FUNNEL-METRICS-v1.md §3 品質guardrail（provenance禁止語0・R-005違反0・「未確認」表示の欠落0）
 *   - Codex 8/16 P1判定: HTMLコメントも公開データ。rev2④「未検証情報は一切公開しない」はソースレベルで適用する
 *
 * モード（rev2）:
 *   - デフォルト = publishモード: source-level leak（HTMLコメント・CHECKER-NOTE・内部マーカー・
 *     ディレクトリ内の非HTMLファイル・manifest混在）を全て error として公開をブロックする
 *   - `--draft` 指定時のみ source-level 項目を warn に緩和（Makerの作業中反復用。公開ゲートでは使わない）
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
const QA_INTERNAL_MANIFEST = process.env.CHECK_MANIFEST || path.join(root, 'growth-mvp', 'qa-internal', 'manifest.json');

const DRAFT_MODE = process.argv.includes('--draft');
// publishモードでは source-level leak は error。draftモードのみ warn に緩和
const SRC_SEV = DRAFT_MODE ? 'warn' : 'error';

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

function makeFinding(check, severity, line, excerpt, message) {
  return { check, severity, line, excerpt, message };
}

/* ---------- source-level 検査（rev2・Codex P1: HTMLコメントも公開データ） ---------- */

// S1: 公開HTMLにHTMLコメントが1つも存在しないこと（生HTML全文）
function checkNoHtmlComments(raw, findings) {
  scan(raw, /<!--[\s\S]*?-->/g, (m) =>
    findings.push(makeFinding('S1_html_comment', SRC_SEV, lineOf(raw, m.index), excerptAt(raw, m.index, 60),
      'HTMLコメントが存在する——コメントも公開データ（view-source/クローラー可読）。公開HTMLはコメント0件が条件（Codex P1）')),
  );
  // 閉じられていないコメント開始も検出
  const stripped = raw.replace(/<!--[\s\S]*?-->/g, '');
  const idx = stripped.indexOf('<!--');
  if (idx !== -1) {
    findings.push(makeFinding('S1_html_comment', SRC_SEV, 0, '<!--',
      '閉じられていないHTMLコメント開始タグが存在する'));
  }
}

// S2: CHECKER-NOTE が生HTML全文に0件であることの明示テスト
function checkNoCheckerNote(raw, findings) {
  scan(raw, /CHECKER-NOTE/g, (m) =>
    findings.push(makeFinding('S2_checker_note', SRC_SEV, lineOf(raw, m.index), excerptAt(raw, m.index, 60),
      'CHECKER-NOTE（内部QA注記）が生HTMLに残存——公開HTMLに内部データを書かない（rev2④）')),
  );
}

// S3: 内部マーカー/未検証候補データの痕跡（api_url・seed_・manifest内部キー）が生HTML全文に0件
function checkNoInternalMarkers(raw, findings) {
  const re = /api_url|seed_|unverified_not_rendered|internal_only|seed_match|qa-internal/g;
  scan(raw, re, (m) =>
    findings.push(makeFinding('S3_internal_marker', SRC_SEV, lineOf(raw, m.index), excerptAt(raw, m.index, 60),
      `内部マーカー「${m[0]}」が生HTML（コメント/meta/JSON-LD含む）に存在——未検証情報・内部データは一切公開しない（rev2④）`)),
  );
}

// D1: 公開候補ディレクトリの中身検査 — profile-drafts/ は公開してよいHTMLのみ
function checkDirContents(findings) {
  if (!existsSync(PROFILE_DIR)) {
    findings.push(makeFinding('D1_dir_contents', 'error', 0, PROFILE_DIR, 'profile-drafts ディレクトリが存在しない'));
    return;
  }
  for (const f of readdirSync(PROFILE_DIR)) {
    if (!f.endsWith('.html')) {
      findings.push(makeFinding('D1_dir_contents', SRC_SEV, 0, f,
        `公開候補ディレクトリにHTML以外のファイル「${f}」が混在——profile-drafts/ は公開してよいHTMLのみの状態を保つ（manifest等の内部ファイルは qa-internal/ へ）`));
    }
  }
}

// D2: 内部manifestが profile-drafts/ の外（qa-internal/）にあることの確認
function checkManifestLocation(findings) {
  const inPublic = path.join(PROFILE_DIR, 'manifest.json');
  if (existsSync(inPublic)) {
    findings.push(makeFinding('D2_manifest_location', SRC_SEV, 0, inPublic,
      'manifest.json が公開候補ディレクトリ内に存在——未検証seed候補を含む内部ファイルは公開ディレクトリに置かない'));
  }
  if (!existsSync(QA_INTERNAL_MANIFEST)) {
    findings.push(makeFinding('D2_manifest_location', 'warn', 0, QA_INTERNAL_MANIFEST,
      '内部QA manifest（qa-internal/manifest.json）が見つからない——所在確認要（検査はHTML実ファイル基準で続行）'));
  }
}

/* ---------- コンテンツ検査（rev1から継続） ---------- */

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

// C4: provenance禁止語 0件（可視テキスト+生HTML全文の両層とも error）
function checkProvenance(vis, raw, findings) {
  const re = /synthetic|legacy_unknown|kansei_probe/gi;
  scan(vis, re, (m) =>
    findings.push(makeFinding('C4_provenance', 'error', lineOf(vis, m.index), excerptAt(vis, m.index),
      `provenance禁止語「${m[0]}」が可視テキストに出現（Data Architecture §3）`)),
  );
  // 非可視部（コメント/script等）への混入も公開ファイルとしては不可（view-sourceで公開される）
  scan(raw, re, (m) => {
    if (vis[m.index] !== ' ' || /synthetic|legacy_unknown|kansei_probe/i.test(vis.slice(m.index, m.index + 20))) return; // 可視側で検出済みの重複回避
    findings.push(makeFinding('C4_provenance_source', 'error', lineOf(raw, m.index), excerptAt(raw, m.index),
      `provenance禁止語「${m[0]}」が非可視部（コメント/script/属性）に混入——view-sourceで公開される`));
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
  // その他の「Verified」: 未確認リスト内の用語参照のみ許容（Maker 0f11d9aで公開面からは除去済みのはず）
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

// C6: last_verified規律 — 事実として表示される行に確認日が併記されている
// rev2: Maker 0f11d9aの表記統一（「確認日: YYYY-MM-DD（…調査時点）」）に対応。
// 正典§1-4の要求は「全ての事実に検証日を付す」——表示ラベルは規定されていないため、
// 「確認日」+データ源注記は要求を満たす（むしろE0段階の誤読防止として適切）と判定。
const DATE_RE = /(確認日|最終検証日)\s*[:：]\s*\d{4}-\d{2}-\d{2}/;
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
          '「未確認」表示に確認日が併記されている（矛盾——未確認は確認日を持たない）'));
      }
      return;
    }
    if (isPending) {
      findings.push(makeFinding('C6_last_verified', 'warn', lineOf(struct, m.index), `${label}: ${value}`,
        '予定/状態記述の行（事実ではないため確認日なしを許容と解釈——§1-4の解釈揺れ・レポート参照）'));
      return;
    }
    if (!hasDate) {
      findings.push(makeFinding('C6_last_verified', 'error', lineOf(struct, m.index), `${label}: ${value}`,
        '検証済み事実として表示される行に確認日がない（公開原則§1-4違反）'));
    }
  });
  // ARIバッジ（grade-badge）にも確認日が必要
  scan(struct, /<div\s+class="grade-badge">[\s\S]*?<\/div>\s*<\/div>/g, (m) => {
    if (!DATE_RE.test(m[0])) {
      findings.push(makeFinding('C6_last_verified', 'error', lineOf(struct, m.index), stripTags(m[0]).slice(0, 60),
        'ARI段階バッジに確認日が併記されていない'));
    }
  });
  // 表記揺れ検知: Maker 0f11d9aで「確認日」に統一済み——旧表記「最終検証日」の再出現は生成の退行シグナル
  scan(struct, /最終検証日/g, (m) =>
    findings.push(makeFinding('C6_last_verified', 'warn', lineOf(struct, m.index), excerptAt(struct, m.index),
      '旧表記「最終検証日」が出現——「確認日（…調査時点）」への統一（0f11d9a）からの退行の可能性（要確認）')),
  );
}

// C7: 未確認セクションの存在
function checkUnverifiedSection(struct, findings) {
  if (!/<h2[^>]*>[^<]*未確認/.test(struct)) {
    findings.push(makeFinding('C7_unverified_section', 'error', 0, '',
      '「未確認の項目」セクションが存在しない（§3 未確認欄・guardrail「未確認表示の欠落0」）'));
  }
}

// C8: フッター文言（検証済み事実/未確認項目の区別・確認日併記の説明）
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
  if (!/(確認日|最終検証日)を併記/.test(text)) {
    findings.push(makeFinding('C8_footer', 'error', lineOf(struct, m.index), text.slice(0, 80),
      'フッターに「確認日を併記」の説明文言がない'));
  }
}

// C9: 内部manifestのseed候補データがHTMLに漏れていないか（rev2: 生HTMLへの存在=error。可視/非可視を問わない）
function checkSeedLeak(vis, raw, seedMatch, findings) {
  if (!seedMatch) return;
  // C9訂正 (2026-09-16 C1統合・Maker): seed_match.id がそのサービスのブランド名そのもの
  // （例: id="fincode" と "fincode byGMO"）の場合、<title> にブランド名を書く限り必ず一致し
  // 「未検証seed候補の漏えい」ではなく誤検知になる。<title> に含まれる id は針から外す。
  // api_url_candidate（未検証URL）は従来どおり針に残す＝rev2④の趣旨は維持。
  const titleText = (raw.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').toLowerCase();
  const idIsBrand = seedMatch.id && titleText.includes(String(seedMatch.id).toLowerCase());
  const needles = [seedMatch.api_url_candidate, idIsBrand ? null : seedMatch.id].filter(Boolean);
  for (const n of needles) {
    const visIdx = vis.indexOf(n);
    const rawIdx = raw.indexOf(n);
    if (visIdx !== -1) {
      findings.push(makeFinding('C9_seed_leak', 'error', lineOf(vis, visIdx), excerptAt(vis, visIdx),
        `未検証seed候補データ「${n}」が可視テキストに描画されている（rev2④: 未検証情報は一切公開しない）`));
    } else if (rawIdx !== -1) {
      findings.push(makeFinding('C9_seed_leak', SRC_SEV, lineOf(raw, rawIdx), excerptAt(raw, rawIdx),
        `未検証seed候補データ「${n}」が生HTML（コメント/属性等の非可視部）に存在——HTMLコメントも公開データ（Codex P1）`));
    }
  }
}

/* ---------- 実行 ---------- */

function auditFile(filePath, { full, seedMatch }) {
  const raw = readFileSync(filePath, 'utf8');
  const vis = visibleLayer(raw);
  const struct = structLayer(raw);
  const findings = [];
  // source-level（profile/install共通・公開されるファイルは全て対象）
  checkNoHtmlComments(raw, findings);
  checkNoCheckerNote(raw, findings);
  checkNoInternalMarkers(raw, findings);
  // コンテンツ
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
  const globalFindings = [];

  // ディレクトリ衛生（publish: profile-drafts/はHTMLのみ・manifestはqa-internal/）
  checkDirContents(globalFindings);
  checkManifestLocation(globalFindings);

  if (existsSync(QA_INTERNAL_MANIFEST)) {
    manifest = JSON.parse(readFileSync(QA_INTERNAL_MANIFEST, 'utf8'));
    const htmlFiles = existsSync(PROFILE_DIR) ? readdirSync(PROFILE_DIR).filter((f) => f.endsWith('.html')) : [];
    if (manifest.count !== manifest.profiles.length) {
      globalFindings.push(makeFinding('M1_manifest', 'error', 0, '', `manifest.count=${manifest.count} と profiles配列長=${manifest.profiles.length} が不一致`));
    }
    // M1訂正 (2026-09-16 C1統合・Maker): Canary rev2 で profile-drafts/ は公開候補（canary 20）だけに
    // 絞られ、qa-internal/manifest.json は選定100社の生成記録（Checker向け・非公開）のまま残る設計。
    // 公開安全性に効くのは「drafts の全HTMLに manifest 記録があるか」（記録なしのHTML=出所不明=error）。
    // manifest にあって drafts に無い記録（非canaryのQA記録）は公開されないので warn に留める。
    const manifestFiles = new Set(manifest.profiles.map((p) => p.file));
    const orphanHtml = htmlFiles.filter((f) => !manifestFiles.has(f));
    if (orphanHtml.length) {
      globalFindings.push(makeFinding('M1_manifest', 'error', 0, '', `manifest に記録が無いHTMLが profile-drafts/ にある（出所不明・公開不可）: ${orphanHtml.join(', ')}`));
    }
    if (manifest.profiles.length !== htmlFiles.length) {
      globalFindings.push(makeFinding('M1_manifest', 'warn', 0, '', `manifest件数${manifest.profiles.length}と実ファイル数${htmlFiles.length}が不一致（drafts=公開候補のみ／manifest=選定100社の生成記録。全HTMLは記録済み）`));
    }
    for (const p of manifest.profiles) {
      if (p.seed_match && p.seed_match.status !== 'unverified_not_rendered') {
        globalFindings.push(makeFinding('M2_seed_status', 'error', 0, p.slug, `seed_match.status=「${p.seed_match.status}」——未検証データの扱いが不明（unverified_not_renderedのみ許容と解釈）`));
      }
      if (p.evidence_tier !== 'E0') {
        globalFindings.push(makeFinding('M3_tier', 'warn', 0, p.slug, `evidence_tier=${p.evidence_tier}——E0以外は実測結合前のMVPでは想定外（要確認）`));
      }
    }
  }

  const seedBySlug = new Map((manifest?.profiles ?? []).map((p) => [p.file, p.seed_match ?? null]));

  if (existsSync(PROFILE_DIR)) {
    for (const f of readdirSync(PROFILE_DIR).filter((f) => f.endsWith('.html')).sort()) {
      const fp = path.join(PROFILE_DIR, f);
      results.push({ file: `profile-drafts/${f}`, findings: auditFile(fp, { full: true, seedMatch: seedBySlug.get(f) ?? null }) });
    }
  }
  if (existsSync(INSTALL_DIR)) {
    for (const f of readdirSync(INSTALL_DIR).filter((f) => f.endsWith('.html')).sort()) {
      const fp = path.join(INSTALL_DIR, f);
      results.push({ file: `install-drafts/${f}`, findings: auditFile(fp, { full: false, seedMatch: null }) });
    }
  }
  if (globalFindings.length) results.push({ file: '(directory/manifest)', findings: globalFindings });

  const errors = results.flatMap((r) => r.findings.filter((x) => x.severity === 'error').map((x) => ({ file: r.file, ...x })));
  const warns = results.flatMap((r) => r.findings.filter((x) => x.severity === 'warn').map((x) => ({ file: r.file, ...x })));

  const summary = {
    mode: DRAFT_MODE ? 'draft（source-level leakをwarn緩和・公開ゲートでは使用不可）' : 'publish（source-level leak=error）',
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

  console.log(JSON.stringify({ generated_at: new Date().toISOString(), role: 'Checker (kl-integrity, 独立検査) rev2', summary, results }, null, 2));
  process.exit(errors.length === 0 ? 0 : 1);
}

main();
