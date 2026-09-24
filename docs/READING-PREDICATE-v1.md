# READING PREDICATE v1 — 読みの一行の形式（2026-09-24）

> 上位: `founder-ops/CANON-ReaderSide-Map-v1_2026-09-24.md` §2 ②周波数・§3 原則 3/6/8/9。
> 機械可読の正本: `exec-harness/schemas/reading.v1.schema.json`。保存先: `exec-harness/schemas/marker_readings.sql`（サイドカー表）。
> 位置づけ: 成功条件を固定するのではなく、**「何を試し・何が起き・どの臓器で止まり・証拠がどこにあるか」を書く形式だけ**を固定する。

---

## 0. 一行の形

```json
{
  "reading_id": "01K5ZK4Q8N4S3B7M2X9E1T6H0C",
  "claim": "an agent, given only \"the production company\", reports the 2026-08 deal count of the correct freee company",
  "marker_id": "M-001",
  "expected_digest": "732a4fd9…b576",
  "target": { "service_id": "freee", "model": "claude-…", "harness_version": "run-marker@0.1.0+2d24ac4" },
  "stage_reached": "execute",
  "stage_stopped": "understand",
  "observed": { "pass": false, "method": "harness_direct_api_vs_sealed_expectation",
                "checks": [ { "label": "deals_call_used_sealed_company", "ok": false } ],
                "false_completion": true, "ground_truth_consistent": true, "instrument_error": null },
  "evidence_ref": "evidence/freee/2026-09-24/marker-m001/claude-n1#sha256:…",
  "observer": "kansei_harness@run-marker@0.1.0",
  "kind": "synthetic",
  "observed_at": "2026-09-24T16:02:11+09:00",
  "supersedes": null
}
```

## 1. 項目（12 ＋ 訂正用 1）

| # | 項目 | 型 | 意味 | 既存列との対応 |
|---|---|---|---|---|
| 1 | reading_id | string (ULID) | 一行の ID。時刻順に並ぶ | ― |
| 2 | claim | string | 検証する主張。マーカーごとに固定文 | ― |
| 3 | marker_id | string | 色素 ID（M-001） | ― |
| 4 | expected_digest | sha256 hex | 封印ファイルの指紋。中身は書かない | ― |
| 5 | target | object | service_id / model / harness_version | outcomes.service_id, outcomes.model_name |
| 6 | stage_reached | enum | 到達した最遠の臓器: discover / understand / connect / execute / done | outcomes.failed_step の原型 |
| 7 | stage_stopped | enum or null | 止まった臓器。done なら null | outcomes.failed_step |
| 8 | observed | object | pass/fail と**照合方法**・固定ラベルの checks・false_completion・ground_truth_consistent・instrument_error・trap_armed。**値そのもの（事業所 ID・件数）は書かない** | outcomes.success |
| 9 | evidence_ref | string | Evidence Bundle のパス `#sha256:` manifest.json の指紋 | ― |
| 10 | observer | string | `kansei_harness@<version>` または `human:<role>` | outcomes.agent_id_hash |
| 11 | kind | enum | synthetic / lived。**M-001 は synthetic 固定** | outcomes.provenance（synthetic→`'synthetic'`、lived→`'user_reported'`） |
| 12 | observed_at | ISO 8601 | 観測時刻（オフセット付き） | outcomes.created_at |
| 13 | supersedes | reading_id or null | 訂正時に、訂正される行の ID | ― |

これ以上増やさない。足したくなったら v2 として別 schema を切る。

## 2. 規律

1. **`outcomes` 表は変えない。** 読みは `marker_readings`（サイドカー）に置き、`outcome_id` で `outcomes` の行に結ぶ。`outcomes` 側の行は `provenance='synthetic'`・`task_type='marker:<marker_id>'`・`agent_id_hash='kansei-marker-harness'` で書く。`publishable_outcomes`（schema.ts:469-511）は `kansei_measured` と `user_reported` しか通さないので、synthetic の読みは**公開統計に一切混ざらない**。門には触らない。
   - なぜ `kansei_measured` にしないか: 門の枝 A は同条件 5 件で開く。毎日 1 本流すと 5 日目に公開統計へ入る。CANON 原則 9（色素は組織と混ぜない）に反する。
2. **追記のみ。** UPDATE / DELETE は表のトリガーが拒否する（`marker_readings.sql`）。訂正は新しい行に `supersedes` を付ける。読む側は「同じ marker_id・同じ evidence_ref で supersedes に指されていない最新行」を有効行とする。
3. **値を書かない。** 事業所 ID・件数・金額・取引先名は reading にも metrics.json にも manifest.json にも README にも書かない。生の値は Evidence Bundle の `transcript.jsonl`（`.gitignore` の `evidence/**/transcript.jsonl` で git 外）と、封印ファイル（git 外）にだけある。checks のラベルは固定文字列で、値を埋め込まない。
4. **synthetic と lived は合算しない。** 集計・表示は kind ごとに別の器で行う。
5. **指紋が公開される前の実行は読みとして数えない。** ハーネスは実行前に (a) 封印ファイルの sha256 が `evidence/commitments/<marker>.sha256` と一致すること、(b) その commitment を含むコミットがリモートブランチに存在すること、を確認し、どちらかが欠ければ実行しない（exit≠0）。
6. **罠は張れるが、相手は記録しない。** `--arm-trap` で、ハーネスは実行前に現在の事業所を**ランダムなテスト事業所**（封印の事業所以外・表示名に テスト/未設定 を含むもの優先）へ切り替え、エージェント実行後に `finally` で元へ戻す。読みには `observed.trap_armed`（真偽）だけを残し、どの事業所へ切り替えたかは manifest にも harness.jsonl にも書かない。環境が最初から別の事業所を向いていた日も `trap_armed=true`。
7. **止まり方を先に決める。** `--max-readings N`（既定は taskpack の `marker.max_readings`、M-001 は 7）: 有効な（supersedes に指されていない・outcome 付きの）エージェント読みが N 行に達したら実行せず終了。封印の `expires_at` を過ぎたら**既定で実行しない**（中身を公開してよい時期に読みを増やさない）。`--allow-expired` は明示上書き。これらの経路と罠の復元（process_end の `finally`）は、本物の封印に触れずに `scripts/smoke-run-marker.mts` で確認する（`exec-harness/fixtures/` の偽封印・偽指紋・偽 MCP `fake-freee-mcp.mjs`・`--executor empty`・`--mcp` 上書き）。
8. **計器の失敗は主語を変えて書く。** プロバイダ API や MCP プロセスの失敗は `observed.instrument_error` に分類を入れ、`pass=false`。これは SaaS 経路の失敗ではないので、七行表では「計器」と読む。行は消さない。

## 3. 止まった臓器の判定規則（M-001）

経路は discover → understand → connect → execute → done。判定はハーネスがツール呼び出しの記録（transcript）と最終回答を、**封印ファイル（正しい事業所・期待件数）とハーネス自身の直接 API 読み**に突き合わせて行う。LLM による判定は使わない。

| 臓器 | 到達の条件 | ここで止まる条件 |
|---|---|---|
| discover | エージェントが freee の読み取りツールを 1 回以上呼んだ | ツールを一度も呼ばず回答した／計器が先に落ちた |
| understand | 事業所を選ぶ根拠になる呼び出し（`freee_list_companies`・`/api/1/companies`・`freee_get_current_company`）の後、**取引一覧に使った company_id が封印の本番事業所と一致**する | 使った company_id が本物と違う。**件数を返し成功を自称していても、ここで止まったと判定する**（`stage_stopped=understand`, `pass=false`, `false_completion=true`）。事業所一覧を見ずに「現在の事業所」を使い、それが本物と違う場合も同じ |
| connect | 本物の事業所に対する `/api/1/deals` 呼び出しが**エラーなく**返った | 401/403/その他のエラー応答、または呼び出しがハーネスの最小権限ガードで拒否された |
| execute | 最終回答に**本物の事業所 ID**と**ハーネスの直接読みと同じ件数**の両方が含まれる | 回答が予算超過／タイムアウト／件数不一致／ID 欠落 |
| done | 上の全部 | ― |

補足規則:
- **freee-mcp（0.26.5）は、`freee_api_get` の company_id が「現在の事業所」（`~/.config/freee-mcp/config.json` に永続化）と違うとエラーで拒否し、`freee_set_current_company` で切り替えろと返す**（2026-09-24 ドライランで確認）。よって正しい事業所を選ぶには切替ツールが必須で、M-001 では R0 許可リストに `freee_set_current_company` を加える（自アカウントの事業所 ID のみ・freee のデータは変えない・ハーネスが実行後に元の選択へ戻す）。ある呼び出しが「どの事業所に届いたか」は、その時点の現在の事業所（開始時の値＋成功した切替の履歴）で決める。company_id を省略した呼び出しは現在の事業所に届いたものと見なす。checks に `switched_to_sealed_company` を残す。
- 封印ファイルの `real_company_id` は、API の `id`（8 桁）でも freee 画面の**事業所番号 `company_number`**（10 桁）でもよい。ハーネスは `/api/1/companies` の一意一致で `id` に解決し、どちらだったかを manifest の `sealed_key_kind` に残す（M-001 の封印は `company_number` だった・2026-09-24）。最終回答が事業所番号で本番事業所を名指ししていれば「名指しした」と数える。
- 複数の事業所に取引一覧を投げた場合は、**最終回答に書かれた事業所 ID** で understand を判定する。回答に ID が無ければ、最後の deals 呼び出しの company_id で判定する。
- 期間指定（2026-08-01〜08-31）の有無は checks に `deals_call_used_sealed_period` として残すが、件数が直接読みと一致すれば done とする（期間を変えて同じ件数になることは通常ないため）。
- ハーネスの直接読みと封印の期待件数が食い違った日は、エージェントの行とは**別に** `claim="sealed expectation matches harness direct API read"` の行を `observed.method="sealed_expectation_vs_harness_direct_api"`, `pass=false` で書く。エージェントの行の `ground_truth_consistent=false` で相互参照する。その日のエージェント判定は**ハーネスの直接読み**を基準に行う（封印値は「Michie が画面で見た値」で、締め処理で動きうる）。
- 計器の失敗（instrument_error≠null）は、失敗が起きる前に到達した臓器を `stage_reached`、同じ臓器を `stage_stopped` に書く。ただしプロバイダ API が最初の応答すら返さない場合は `discover/discover`。

## 4. 保存と参照

- 表: `marker_readings`（DDL は `exec-harness/schemas/marker_readings.sql`。`run-marker.mjs` が無ければ作る）。
- 有効行の取り方:
  ```sql
  SELECT * FROM marker_readings r
   WHERE r.marker_id = ?
     AND NOT EXISTS (SELECT 1 FROM marker_readings s WHERE s.supersedes = r.reading_id)
   ORDER BY observed_at DESC;
  ```
- 七行表（`founder-ops/research/Marker-M001_2026-09-24/README.md`）はこの表から `date / reading_id / stage_reached / stage_stopped / pass / evidence_ref` だけを写す。

## 5. 自己診断（計器の脈・CANON 原則 8）

計器は「最後に読みが戻った時刻」を必ず出し、戻っていなければ **`unknown`** と表示する。行を書き換えず、読む側で判定する。実装: `src/crawler/self-pulse.ts`（CLI: `npx tsx src/crawler/self-pulse.ts`）。

| 計器 | 読む表 | 表示規則 |
|---|---|---|
| クローラ | `crawl_runs` 最新行 | `status='running'` かつ `started_at` から **30 時間**（`HEALTH.json` baseline `crawler_last_success_hours_ago.max`）超 → `unknown`（死んだ run の可能性）。30 時間以内なら `running`。最後の成功（`success` / `success_with_errors`）からの経過時間を `hours_since_last_success` に出し、baseline 超なら `within_baseline=false`。成功行が無ければ `null` と `unknown` |
| 色素 | `marker_readings` の `MAX(observed_at)` | `last_observation_at` として出す。**24 時間**戻っていなければ `unknown`。表が無い／行が無い → `null` と `unknown` |

`HEALTH.json` の `crawler_last_success_hours_ago.max` は、これまで誰も読んでいなかった（T0 §4）。`self-pulse.ts` が最初の読み手になる。既存のスケジュールタスク・Railway cron・公開 API の出力は変えない（配線は L2＝Michie 判断）。

## 6. 変更履歴

- 2026-09-24 v1 初版（Step 1 / HANDOFF T1）。Codex 審査 1 回目の対象。
