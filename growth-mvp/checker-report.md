# Checker Report — Profile Drafts 独立検査（2026-08-16）

- 検査者: Quality & Integrity（Qレーン・kl-integrity）— **Makerと独立**（`scripts/generate-profiles.mjs` の実装は不読。検査対象は出力物と設計正典のみ）
- 検査ツール: `scripts/check-profiles.mjs`（本レポートと同時に納品・正典から独自解釈で実装）
- 検査対象: `growth-mvp/profile-drafts/*.html`（10件・全項目）+ `manifest.json` + `growth-mvp/install-drafts/*.html`（6件・score/rank と provenance語のみ）
- 検査基準: `founder-ops/PLAN-Profile-Claim-MVP-v1.md` §1/§3/§4.0/§5、`founder-ops/FUNNEL-METRICS-v1.md` §3 品質guardrail

## 判定サマリ

**PASS — 公開ブロック該当（error）0件。exit code 0。**（warn 42件は全て許容判定済みの要目視項目・下記参照）

| # | 検査項目 | 判定 | error | warn |
|---|---|---|---|---|
| C1 | R-005: 成功率・%数値・率+数字の表示 | **違反0** | 0 | 0 |
| C2 | ARIスコア・順位・点数の非表示（段階バッジは許容） | **違反0** | 0 | 10 |
| C3 | 断定的否定表現（使えない/接続できない/非対応/非推奨等） | **違反0** | 0 | 0 |
| C4 | provenance禁止語（synthetic/legacy_unknown/kansei_probe）— 可視+非可視ソース両方 | **違反0** | 0 | 0 |
| C5 | Claimed / Company Representative Verified / Tier表示名（Tested等）の表示 | **違反0** | 0 | 10 |
| C6 | last_verified規律（事実行に最終検証日・未確認行に日付なし） | **違反0** | 0 | 10 |
| C7 | 未確認セクションの存在（10/10ページに存在） | **違反0** | 0 | 0 |
| C8 | フッター文言（区別説明+検証日併記説明・10/10ページに存在） | **違反0** | 0 | 0 |
| C9 | manifest `unverified_not_rendered` の可視面漏れ | **描画漏れ0** | 0 | 12 |
| M1-M3 | manifest整合（count/実ファイル数/status/E0） | **問題なし** | 0 | 0 |
| — | install-drafts 6件（C2+C4のみ適用） | **全件 findings 0** | 0 | 0 |

## 「検出0件」の根拠（検出能力の証明）

正常系PASSだけでは「検査が甘くて通った」と区別できないため、**seeded violationsテスト**を実施した:
agileworks.html のコピーに9カテゴリの違反（成功率97.3%・スコア87点/100点満点/2位・「非推奨で実質接続できない」・kansei_probe/synthetic可視混入・「Claimed 済み — Public Verified」表示・検証日なしの事実行・未確認セクション削除・フッター文言削除・seed候補URLの可視描画）+ install側にスコア数値/legacy_unknown を注入し、環境変数 `CHECK_PROFILE_DIR`/`CHECK_INSTALL_DIR` で差し替え実行。
→ **22 error 全カテゴリ検出・exit 1** を確認（manifest件数不整合も同時検出）。検査器は機能している。

## 補完チェック（機械検査の対象外を手動確認）

- **meta description / OG系属性値**（タグ除去で可視スキャンから外れる）: 全16ファイルをgrepで別途走査——%数値・点数・スコア・順位・provenance語・Claimed/Verified の混入なし
- **JSON-LD**（script除外でスキャン対象外だが機械可読で公開される）: 全10件 `SoftwareApplication` で name+applicationCategory のみ。`aggregateRating`/`ratingValue` 等の評点プロパティなし——AI引用面でもスコア非公開が守られている
- **データ源との突合**: 10社の grade/カテゴリ/MCP/認証/検証日は `src/data/ari-award-2026-summer-csv.ts`（ARI Award 2026 Summer 正典・2026-07-21）のランキング1〜10位と完全一致。全社AAA・公式MCP・OAuth 2.0という一様性はMakerの捏造ではなくデータ源に忠実。**ARI正典が持つ「スコア(90点満点)」「順位」列はProfileに描画されていない**（Codex 8/16指定どおり）

## warn 42件の内訳（全て許容判定・公開ブロックではない）

1. **C2×10**: claim-box免責文「申請の有無で格付け・順位は変わりません」に数値を伴わない「順位」の語。順位を*表示*していないため非違反と判定（下記・食い違い①）
2. **C5×10**: 未確認リスト内「接続実測（Connection Verified）の実施と検証日」。未確認文脈での用語参照であり、Verified状態の主張ではないため許容（§5 の「VerifiedはEvidence Tier系に予約」とも整合——Connection VerifiedはE1の正典用語）
3. **C6×10**: 「次回検証: 準備中」行に検証日なし。事実ではなく予定記述のため許容と解釈（下記・曖昧さ②）
4. **C9×12**: seed候補データ（api_url候補・seed_id）がHTMLコメント（CHECKER-NOTE）内に存在。**描画はされない**が下記・指摘P1参照

## Makerの想定との食い違い・設計の曖昧さ（率直な指摘）

### P1: CHECKER-NOTEコメントに未検証seedデータが同梱されている（公開前に除去要）
- 対象: agileworks / freee-sign / freee-kyuyo-keisan / square / wrike / zoho-crm の6ファイル（例: agileworks.html 61行目 `api_url候補=https://www.atled.jp/agileworks/ / seed認証=unknown`）
- PLAN rev2④は「未検証のvendor_reportedは**一切公開しない**——内部審査キューのみに保持」。HTMLコメントは描画されないが、**view-source・クローラー・AI引用には公開される**。manifest（unverified_not_rendered）の趣旨=「レンダリングしない」は守られているが、「公開しない」の水準には達していない
- 推奨修正（実装レーンへ差し戻し）: 公開ビルド時にHTMLコメントを全stripする工程を挟む、または候補データはmanifest側のみに保持しHTMLへ一切書かない。**manifest.json自体も公開ディレクトリへデプロイしない**こと（未検証URL候補を含むため同じ理由で内部資料扱い）
- 現時点はドラフト（非公開・隔離ブランチ）のためP0ではない。**公開ゲート時にP0昇格**

### P2: Codex指定パターン「順位」の字義どおりの適用は免責文と衝突する
- Codex 8/16指定の禁止パターンに裸の「順位」が含まれるが、全10ページの免責文「申請の有無で格付け・順位は変わりません」に同語が出現する。これは順位の表示ではなく「順位を売らない」宣言であり、削除するとむしろ独立性の説明が弱くなる。Checkerは「順位+数値」をerror、裸の語をwarnとする解釈を採った。**この解釈でよいかCodex/Michieの確認を推奨**（あるいは免責文を「格付けは変わりません」に統一して語自体を消す選択肢もある）

### P2: 「次回検証: 準備中」行と公開原則§1-4の解釈揺れ
- §1-4「検証日なしの事実は公開しない」を字義どおり読むと、検証日のない「準備中」行も引っかかる。Checkerは「予定/状態記述は事実ではない」と解釈して許容したが、正典に「予定記述の扱い」の明文がない。PLAN §3の「更新」セクション定義（次回検証予定を項目として要求）と§1-4の間の軽微な緊張。正典側に一文追記が望ましい

### P2: E0ページの「基準データ」検証日の意味の二重性
- ページ冒頭とフッターの「最終検証日: 2026-07-21」はARI Award確定データの日付であり、接続性欄（MCP提供状況・認証方式）の検証日も同日=同一データ源。読者が「KanseiLinkが2026-07-21に接続実測した」と誤読する余地はゼロではない。各ページはE0（未実測）を明示しており誤読リスクは低いが、接続性欄に「（ARI Award調査時点）」等のデータ源注記があればより堅い。改善提案であり違反ではない

### 問題なしの明記
- 実名リスク（名誉毀損）: 否定的断定0・推測の断定0・「未確認は評価ではない」の但し書きあり——**問題なし**
- 独立性: 「申請の有無で格付け・順位は変わりません」「Evidence TierはClaimの有無では変わりません」の明記あり、支払い/Claimとスコアの結線を示唆する表現なし——**問題なし**
- 機密混入: テナントID・実名研究データ・APIキー・内部パスの混入なし（CHECKER-NOTEのseed候補は上記P1のとおり公開前除去要）——**それ以外は問題なし**
- 正典整合: 用語（Evidence Tier E0-E3・段階バッジ・未確認（検証予定）・Claimed/Verified分離）は正典と一致。新規概念の発明なし——**問題なし**

## 再現手順

```
node scripts/check-profiles.mjs   # exit 0 = PASS / exit 1 = 公開ブロック
```
