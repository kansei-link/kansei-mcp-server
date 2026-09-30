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
| 8 | observed | object | pass/fail と**照合方法**・固定ラベルの checks・false_completion・ground_truth_consistent・instrument_error・trap_armed・**undetermined（未判定＝エージェント側の観測が合格とも偽の完了とも言えない。llm_answer では回答領域の形式違反・REPO: none・AUTH: unknown、fetch_check では開けなかったページ。pass／false_completion／undetermined／instrument_error の真はちょうど一つ）**。**値そのもの（事業所 ID・件数）は書かない** | outcomes.success |
| 9 | evidence_ref | string | Evidence Bundle のパス `#sha256:` manifest.json の指紋 | ― |
| 10 | observer | string | `kansei_harness@<version>`、`human:<role>`、または観測したのがエージェント自身のとき `<agent-cli>@<版>`（例 `claude-code@2.1.274`・`codex@0.153.4`・M-003） | outcomes.agent_id_hash |
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
- 複数の事業所に取引一覧を投げた場合は、最終回答の事業所 ID に対応する **実際の deals 呼び出し先**を確認する。回答 ID だけでは到達先を代替できない。切替失敗後の不整合な要求 ID も到達先には数えない。本物への deals 呼び出しがなければ `understand` で止まる。
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

### run-marker 0.3.0 の保存・訂正

- ハッシュの向きは **reading → manifest → metrics**。`metrics.json` は一度だけ書く。その `readings` は `evidence_ref` を除いた観測ペイロードであり、manifest の sha256 から `evidence_ref` を復元すると完全な述語になる。完全な述語は DB に保存する。manifest 生成後に metrics を書き換えない。対象 Evidence ファイルは `.gitattributes` の `-text` で Git blob のバイト列を保持する。
- `--mcp`・環境変数 `KANSEI_MCP_COMMAND`（`.env` を含む）・`--executor empty`・fixture の pack/封印/指紋は **非 dry-run を exit 5 で拒否**する。コピーされた既知 fixture の封印も sha256 で検出する。dry-run の manifest にも `environment.mcp_command` と `environment.executor` を残す。
- 残り枠を起動時と **各 run 前**に確認し、同じ起動でまだ保存していない読みも数える。起動時に満杯なら読み取り専用で終了する。最終 INSERT の immediate transaction 内でも枠と訂正対象を再確認する。
- 訂正は `--supersedes <agent-reading-id>`、直接読みの訂正は `--supersedes-ground-truth <reading-id>`。同じマーカー・指紋・サービス・主語の有効行だけを対象とし、1 model / 1 run で実行する。元行と元 Evidence は変更・削除しない。README に訂正元 ID を表示し、直接読みが一致へ変わった場合も訂正行を残す。
- synthetic は `reliability-source` の `estimated_reports` にも加算しない。脈の閾値判定は丸め前の時間で行い、表示用の時間だけ丸める。
- 回帰試験: `scripts/smoke-marker-{judge,bundle,isolation,limits,quarantine}.mts`。D-2 の6履歴、Git blob の指紋、非 dry-run 拒否、6→7での停止、期限停止、追記による訂正を架空データで検証する。limits 試験は独立したローカル Git sandbox とテスト専用 preload で I/O を置換し、本番コードに検疫の迂回フラグを設けない。

## 5. 自己診断（計器の脈・CANON 原則 8）

計器は「最後に読みが戻った時刻」を必ず出し、戻っていなければ **`unknown`** と表示する。行を書き換えず、読む側で判定する。実装: `src/crawler/self-pulse.ts`（CLI: `npx tsx src/crawler/self-pulse.ts`）。

| 計器 | 読む表 | 表示規則 |
|---|---|---|
| クローラ | `crawl_runs` 最新行 | `status='running'` かつ `started_at` から **30 時間**（`HEALTH.json` baseline `crawler_last_success_hours_ago.max`）超 → `unknown`（死んだ run の可能性）。30 時間以内なら `running`。最後の成功（`success` / `success_with_errors`）からの経過時間を `hours_since_last_success` に出し、baseline 超なら `within_baseline=false`。成功行が無ければ `null` と `unknown` |
| 色素 | `marker_readings` の `MAX(observed_at)` | `last_observation_at` として出す。**24 時間**戻っていなければ `unknown`。表が無い／行が無い → `null` と `unknown` |

`HEALTH.json` の `crawler_last_success_hours_ago.max` は、これまで誰も読んでいなかった（T0 §4）。`self-pulse.ts` が最初の読み手になる。既存のスケジュールタスク・Railway cron・公開 API の出力は変えない（配線は L2＝Michie 判断）。

## 6. 対象の一般化（run-marker 0.4.0・HANDOFF 列2 §2）

述語・台帳・bundle・README 追記・停止条件は対象に依らない。対象で変わる三つ（正解の取り方・観測の取り方・判定規則）だけを taskpack の `marker.kind_of_truth`（＋`marker.observation`）で選び、`exec-harness/lib/marker-targets.mjs` の対象モジュールが担う。`mcp_direct_read`（M-001）は従来の経路のまま。

| kind_of_truth / observation | 正解（ハーネス） | 観測 | observer 列 | 止まった臓器の規則 |
|---|---|---|---|---|
| `http_probe` / `catalog_display`（M-002） | 封印の各エンドポイントへ MCP initialize を POST。gone(404/410)・dns_fail・connection_refused を死亡と数える。1 件でも生き返れば正解側の別行（`sealed_expectation_vs_harness_http_probe`・pass=false） | 公開カタログ（本番 MCP `tools/call lookup detail`・読むだけ）の表示トークン＝`mcp_status`＋（freshness.confidence が high なら `updated`） | `kansei_harness@…`（観測者はハーネス） | カタログ API に届かない → discover（計器）。どれか 1 件でも禁止トークン（verified/updated/確認済み/更新済み）→ **understand・pass=false・false_completion=true**（自分の状態の誤認）。カタログにその service が無い → 誤認ではないので通過。全件通過 → done |
| `http_probe` / `fetch_check_summary`（M-003） | 封印の各 URL を直接取得し本文 sha256 を封印と照合。不一致＝ページが変わった＝正解側の別行（エージェントの失敗ではない） | 既存 fetch-check の `<日付>.json`（fetched/denied/unclear/error）を観測者ごとに読む。当日分が無い観測者は行を立てない | `claude-code@<CLI版>` / `codex@<CLI版>`（観測したのはエージェント自身）。`target.model` は要約の agents | error → 計器。wiki ページが denied／欠落 → discover。unclear → understand。wiki ページ全部 fetched → done（対照ページは check にだけ残す） |
| `llm_answer`（M-004＝発見と理解。接続・完遂は M-005） | 封印のリポジトリが GitHub API で公開・未アーカイブか。消えれば正解側の別行（`sealed_repo_vs_github_api`） | 公開 LLM 4 社（openai/gemini/perplexity/claude）へ課題文だけを 1 問 1 答（検索ツールなし・7/29 と同じ）。モデル 1 つにつき 1 行 | `kansei_harness@…`、`target.model`＝プロバイダが返したモデル名 | 封印のリポジトリ URL（大小文字・`.git`・`#` 無視・別パスは不可）を含む → discover 通過。`OAuth 2.0`/`OAuth2` を肯定 → understand 通過＝**done**（この色素の主張は発見と理解までなので、その二つが通れば done）。URL なし → discover で停止、「公式 MCP は未確認／存在しない」と断言していれば false_completion。URL ありで Basic／API キーと断言 → understand で停止＋false_completion。認証に触れない → understand で停止（false_completion なし）。プロバイダ API の失敗 → 計器 provider_api |
| `natural_task`（M-006＝自然な仕事・発見と理解。2026-09-30） | M-004 と同じ（封印のリポジトリが GitHub API で公開・未アーカイブか。`sealed_repo_vs_github_api`）。封印は同じ公式リポジトリ URL を **M-006 として別の salt で封印し直した物**（指紋が違うので M-004 の台帳と混ざらない） | 利用者が頼む形の課題文だけ（回答形式も選択肢も見せない）を、提供者自身の検索・取得の道具を有効にして一回頼む。構成＝`marker.configs`（openai＝Responses API web_search・gpt-5.5 日付固定・所在地 JP／anthropic＝Messages API web_search_20250305＋web_fetch_20250910・claude-opus-5-5／perplexity＝Agent API preset fast・web_search＋fetch_url／claude-code＝`claude -p` を隔離して・claude-opus-5-5）× 課題文の変種（N1 MCP を名指す・N2 名指さない）。構成×変種ごとに 1 行、`target.setup`（reading.v1.1）に構成を明記 | `kansei_harness@…`（setup が構成を持つ） | **二つの閉じた跡だけ**（`lib/natural-task-rules.mjs`）。発見＝応答の構造化された欄（取得＝模型が開いた／提供者が取った／fetch_url に頼んだ／CLI が取った URL、引用＝提供者の構造化された引用欄だけ: OpenAI と Perplexity は output_text の `annotations` の `url_citation`、Anthropic は text の `citations`。**Perplexity の本文の `[n]` の印は読まない**（2026-09-30 撤去: 自由文を読む部品は持たない）。Claude Code と、`annotations` の欄が無い応答は「跡なし」）の URL を一つずつ丸ごと `sourceRepoKey` に渡し、封印に解ければ通過。取得は「要求」そのものを数える（結果が返らなかった要求も取得の要求）。候補（検索結果に出ただけ）は記録するが数えない。本文や回答文から URL を探すことはしない。理解＝成果物（厳格な JSON〔同じオブジェクトにキーが二度あれば成果物と数えない〕で最上位に `mcpServers` を持つコードブロックか作業フォルダのファイルがちょうど一つ。項は command が文字列・args が文字列の配列・env が文字列の対の時だけ読む）が公式 README の二つの形（P2 入口パス＋env ACCESS_TOKEN/SYSTEM_URL・P3 npx mcp-remote＋ヘッダ x-access-token/x-system-url）のどれかを指し認証の欄が正しければ done。認証の欄は**置き場所ごと**に見る（P2 は env 自身の `ACCESS_TOKEN` と `SYSTEM_URL`、P3 は `--header` か mcp-remote の URL の query 自身の `x-access-token` と `x-system-url`。別の場所にある同じ名前は数えない）。Basic／API キー風の欄＝偽の完了で、その項の**全ての置き場所**（env のキー名と値・`--header` の名前と値・URL の query 名）を見る。`Authorization`（大小文字不問）の値が `Basic` で始まればどこにあっても誤り。成果物なし・複数・解析不能＝未判定。道具を一度も呼ばなかった＝未判定。**読む前に閉じた形で検査する（Codex fe0d132・2026-09-30）**: `output[]`／`content[]`／イベントの各項はオブジェクトで文字列の `type` を持ち、読む type の項は必須欄と型が合っていること。外れたら計器 `other`（対象の未判定にしない。欠けた欄は「無い」であって「空」ではない）。知らない type で形の整った項は読み飛ばし、type 名だけ private に残す。Claude Code は先に「終了コード 0・`result` がちょうど一つ・`is_error=false`・`subtype=success`」と「`system/init` がちょうど一つ・`tools`／`mcp_servers`／`plugins` が配列として在る・tools が許した三つに完全一致・他の二つは空」を検査し、外れたら計器（`provider_api`／`budget`／`other`）で、作業フォルダに残ったファイルも採点しない。取得した URL・成果物・読み飛ばした type 名は `environment.private.json`、生の応答と作業ファイルは `<観測者>/transcript.jsonl`（どちらも private・git 外）。公開の行は真偽だけ。**提供者が報告する model は `^[a-z0-9][a-z0-9.\-]{0,63}$` を通った値だけ公開**し、通らなければ taskpack の構成値を出して報告値は private へ（CLI の版も 数字.数字.数字 だけ）。表は**構成（構成 id＋変種＋取得の意味）ごと**に止まった日数・偽の完了・未判定を数え、構成をまたぐ合計は出さない。**Gemini の検索ありは提供者の規約により測らない**（二行形式の道具なし Gemini は M-004 に残る） |

**M-004 の封印はリポジトリ URL だけ。** 理解段階の期待値（認証方式 `OAuth 2.0`）と誤方式トークン（`Basic`・`APIキー`・`API key`）は**判定規則の定数**（`lib/marker-targets.mjs` の `AUTH_RULE`）であって封印値ではない。封印に `auth_method` 等が書かれていても読まない（規則が封印の中に隠れないようにするため・Codex 審査 2 の P2/D）。マーカー ID は述語の `^M-[0-9]{3,}$` に従う（`M-004a` は不可。旧 M-004a は M-004 に改名、将来の接続・完遂は M-005）。

**閉じた判定**（Codex 審査 2 の差し戻しで確定・2026-09-25）: 必要な印がすべて揃い、悪い印が一つも無いときだけ done。曖昧・矛盾・観測不能は不合格か計器エラーであって、決して done ではない。

- `catalog_display`: 観測は「整った tool 結果」か「カタログ自身の明示の not found」だけ。JSON-RPC の error・tool の isError・パースできない payload・別 service の payload・その他の error 文は**計器**（discover で停止・pass=false・false_completion=false）。封印の全 service が観測できた日だけ判定に進む（check `every_service_observed`）。
- `fetch_check_summary`: status は fetched／denied／unclear／error／missing の五つだけ。未知の status は計器。done は「wiki ページが 1 本以上あり、全部 fetched」のときだけ。要約の `date` が当日でなければ（明示 `--fetch-summary` でも）行を立てない。
- **M-004 は閉じた形式で問う（2026-09-27・Michie）。誘導の大きさは記録する。** 自由文の判定はこれ以上直さない。課題文の末尾にハーネスが二行の回答形式を付け（`lib/llm-answer-rules.mjs` の `ANSWER_FORMAT`）、判定はその二行だけを読む: `REPO: <公式 MCP サーバーのリポジトリ URL を 1 つ、無ければ none>` ／ `AUTH: <OAuth 2.0 | Basic | API key | unknown のうち一つ>`。説明文は transcript.jsonl（git 外）に証拠として残すが判定に使わない。規則: REPO=封印 → 発見通過。REPO=none → discover 停止・undetermined。REPO=別 URL（丸ごと URL として解析し hostname 完全一致・深い path や別 host は別 URL）→ discover 停止＋偽の完了。AUTH=OAuth 2.0 → done。AUTH=Basic／API key → understand 停止＋偽の完了。AUTH=unknown → understand 停止・undetermined。二行の欠落・重複・形式外の値・複数 URL・行内の説明 → **format_violation＝エージェント側の未判定**（計器エラーではない・`checks` の `format_violation` が false）。**誘導の大きさ**: AUTH の選択肢に期待方式が含まれる（4 択の中の 1 つを名指し）。REPO は URL を求めるだけで名指ししない。この事実を manifest の `prompt_guidance`（形式・行数・列挙した選択肢・漏らしたもの）に毎回記録し、読みを割り引く材料にする。
  - **回答領域＝回答の末尾の空でない二つの物理行**。この二行が順に `REPO: 値`・`AUTH: 値`（ASCII のラベルとコロン・大小文字不問・値は空でない・行内に改行を含まない）でなければ format_violation。二行より後に文がある・順序が逆・値が空・ラベルだけで値が次の行、はすべて形式違反。それより前の本文（説明・コード引用・二行に似た例示）は判定に一切関係しない。
  - **形式の検査を内容の評価より先に行う。** REPO と AUTH の値のどちらか一方でも形式を外れれば、REPO の内容にかかわらず format_violation。
  - **値は種類ごと閉じる（2026-09-28・Michie）。** どちらの値も、許す包み `<…>`・`` `…` ``・`"…"` を**一組だけ**剥がす（内側は trim しない）。その後、
    - REPO は `none` か、正規形 `^https://(REPO_HOSTS の完全一致)/<owner>/<repo>(\.git)?/?$` に**文字列全体が一致**したものだけ（owner・repo は ASCII の英数字と `_`・`.`・`-`、ドットだけは不可）。URL の解析器は使わず、trim・デコードもしない。比較の key は host/owner/repo を ASCII 小文字にし、リポジトリ名の末尾の `.git` を一つ外したもの。したがって**ポート（`:443` も）・userinfo・末尾ドットの host・`http`・クエリ・fragment・パーセントエンコード・バックスラッシュ・包みの内側の空白（全角・縦タブを含む）・scheme 無し・`www.`・深い path・一重引用符や「」の包み・二重の包み**はすべて format_violation で、内容の評価に届かない。
    - AUTH は `OAuth 2.0`／`Basic`／`API key`／`unknown` の**四語のどれかに完全一致**（前後に許すのは ASCII のスペース・タブだけ）。`OAuth2`・`Basic 認証`・`APIキー`・`不明` などの表記揺れは format_violation。
    - 大小文字だけは区別しない（ラベル・scheme・host・owner/repo・AUTH の四語。ASCII に限る。正規表現は `u` フラグなしで、非 ASCII 文字が ASCII の代わりにならない）。
  - ① URL トークン（`extractUrlTokens`）: judge では使わない。後の列（A・B）でページを走査するために残す。
  - ⑤ 三値の排他: エージェントの読みは pass／false_completion／undetermined／instrument_error の**真がちょうど一つ**。候補ゼロ（REPO=none）も undetermined に分類する。保存前の検証（`validateReading`＋`assertExclusive`）と `reading.v1.schema.json` の `observed.oneOf` の両方で強制。例外は正解側の行（`sealed_*`・pass=整合）と、固定 runtime で動く M-001 の従来 method（七行が並んだ後に見直す）。
  - fetch_check: denied／unclear／missing は「エージェント側の未判定」（undetermined=true）。error・未知 status は計器。
  - **切り分けの三列（ATTRIBUTION-Rules v0.1・M-004 臓器1）— 2026-09-29 夕（Codex 7e9a3e2 差し戻しを受けた §4-2 改訂）: A・B の解釈を計器から外し、人の確認に渡す。計器は変化の検知だけ。**A1・A2・B の三つの出典について毎日本文を取得し sha256 を取る（A＝HTTP 200 で最後まで受信した生のバイト列、B＝カタログの項の**原文**（tool result の text・解析する前の文字列）から作る正準形から、毎回・毎日変わる二葉だけを除いたもの。**2026-09-30（Codex 544808b R2）: 指紋は値の往復を通さない。** `JSON.parse` した値を `JSON.stringify` し直すと情報が落ちる（`1e400`→`null`、同じキーが二つあると先の値が消える、`3.0000000000000000001`→`3`、`1e5`→`100000`、2^53+1→2^53、`-0`→`0`）ので、原文を厳格な JSON 走査器（RFC 8259・`lib/attribution-attest.mjs` の `scanStrictJson`・node 組み込みだけ）でトークンごとに読み、`catalogBodyFromText` が正準形を作る: キーは解いた文字列の符号単位順に並べ替え、数値・true／false／null は原文の字面のまま、文字列は解いた値を書き直す（値が同じなら同じ）、空白は捨てる。文法違反・値の後ろの余り・一つのオブジェクト内の重複キー（エスケープを解いた後で比較）・深さ 64 超・1 MiB 超・tool result の content が text のブロックちょうど一つでない時は**本文なし**＝B は未確定（計器・check `catalog_body_canonical`=false・private sidecar に `body_not_canonical` と理由）で、確認の照合へ進まない。人の確認ファイルと `observers.json` も同じ走査器を通す（キーの重複は「後勝ち」ではなく無効）。除くのはそのトークンの字面が「勝手に変わる値の文法」に完全一致する時だけ（`_meta.attempt_id` は `"`＋RFC 4122 の小文字 UUID＋`"`、`freshness.data_age_days` は `/^(0|[1-9][0-9]{0,4}|100000)$/`。エスケープ・符号・小数点・指数を含む字面は一致しない＝残す。Codex 1391a31 R1）。したがって二つの原文の本文が同じになるのは、違いが空白・キーの順序・文字列のエスケープ表記・この二葉だけの時に限る（回帰: `scripts/smoke-marker-attribution.mts` の Part A4・Part I〔Codex の独自検証 234 件〕・Part J〔種を固定したランダム 2000 組〕）。それ以外の値（URL・大文字・空・別の形・負や巨大な数）はその葉も本文に残す・親の一括除外はしない・taskpack の `catalog.body_fields`＝`all_except:_meta.attempt_id(rfc4122-uuid-lowercase),freshness.data_age_days(int 0..100000)` で固定）。A・B の状態は、当日の本文 sha256 に一致する有効な人の確認 `evidence/attestations/<marker>-<source>-<sha256>.json`（verdict＝listed／not_listed）からだけ取る。無ければその出典は「未確定（本文に変化あり・要再確認）」で、private sidecar と README の正解側の行に要再確認の印を出す。確認の検証は許す値の一覧で縛る（Codex 5758e0a 差し戻し後・禁止語で弾く方式はやめた）: キー 10 個ちょうど・判断を決める欄は許す値か計算値に完全一致（verdict＝listed／not_listed、observer＝`evidence/attestations/observers.json` の一覧、date＝実在の日付で今日以前、target は taskpack の出典と一字一句一致、marker_id/expected_digest/source_id/body_sha256 も一致）。reason は判断を決めない注記（空でない・200 字以内・制御文字と改行〔U+000A/U+000D/U+0085/U+2028/U+2029 を含む〕が無い）で、TODO 等の語は有効性に関係させず private sidecar に注意だけ。下書きは verdict の欄を持たない（`lib/attribution-attest.mjs` の validateAttestation・loadObservers）。自動の読み（classifySource）は公開の行・判断・SHEET に一切影響せず、private sidecar の「手がかり」だけ。行の checks は `*_attested_listed`・`*_attested_not_listed`・`*_needs_recheck`（表示はこの印がある時だけ載っている／載っていない）。回帰: Codex の独自検証 94 件（`exec-harness/fixtures/attribution-cases-7e9a3e2.json`・逐語は `fixtures/evidence/codex-7e9a3e2-independent-cases.json`）。**以下は履歴。**同日昼（8d905ee の審査後）に §4-2 で縮小（Codex 8d905ee の N1・N2・N3 を種類ごと閉じる）: 自動の読みは「載っている」と「未確定」だけを返す。「載っていない」（会社側・KanseiLINK 側を責める判断）は、その日の本文の sha256 に結びつけた人の確認 `evidence/attestations/<marker>-<source>-<sha256>.json`（observer=human:<名前>・日付・対象・本文 sha256・verdict=not_listed・一行の理由・封印の指紋）がある時だけ記録し、表に「人の確認」と札を出す。本文が変われば確認は自動で失効する。A の本文＝HTTP 200 で最後まで受信した生のバイト列、B の本文＝項の文字列欄（先頭が `_` のキーと `freshness` を除く）の [欄, 値] をパス順に並べた JSON。出典のトークン化では http・https 以外の scheme（data: mailto: javascript: urn: 等、`//` の有無を問わない）が現れたら、その後ろは空白まで中身を見ない（N1）。percent-encode された名前は解かない＝未確定（N2）。任意部品（attribution-rules と同梱解読器の六ファイル）の指紋読み出しの例外はすべて捕まえて null（N3）。以下の「載っていない」の自動条件は 2026-09-28 時点の記述で、今は使っていない**: 「載っている」＝URL トークンが封印 key にきれいに解ける時だけ。「載っていない」＝観測が完了し（HTTP 200・本文を最後まで受信・タイムアウト内）、かつ解いた後の本文に封印の owner 名も repo 名も（大小文字不問の部分一致で）一度も出ず、ホスト名の近くに解けない文字参照も無い時だけ。それ以外はすべて「未確定」（A は U1・B は U2）。行では pass＝載っている、instrument_error=other＝未確定。URL トークンは文字を削らない（`/.`・`/..`・`%2e`・バックスラッシュを含むものは解けない）。文字参照は同梱の WHATWG 準拠の解読器（entities 8.1.0・`exec-harness/vendor/`）で一度だけ解く。U0 の日は判断の段で AI の読みを外したと数えないが、「三つの数字」（止まった日数・偽の完了）は従来どおり全ての読みを数える。回帰に Codex の独立検証 110 件（`exec-harness/fixtures/attribution-cases.json`）。**使わない部品で既存の色素を止めない**: 出典の読み取り（`lib/attribution-rules.mjs`）と同梱の解読器は M-004 の attribution を実行する所で初めて動的 import する。表示と判断の関数は import を持たない `lib/attribution-labels.mjs` にあり、marker-persist と表の描画はそれだけを読む。読み込めない時は A・B の二行だけが計器エラー（U1/U2）になり、M-001・M-002・M-003 と M-004 のエージェントの読みは影響を受けない（回帰: `scripts/smoke-marker-optional-parts.mts`＝vendor を消した複製で確かめる）。以下は 7baf754–185d63d の記述: 実行ごとに正解側の行を二つ足す（method は `sealed_` で始まり、`outcome_id` を持たず max_readings に数えない）。A＝`sealed_repo_vs_official_docs`: taskpack の `marker.attribution.official_docs`（A1・A2 の URL を固定）を取得し、HTML の文字参照（`&amp;`・`&#x2F;` 等）を一度だけ解いてから URL トークン（href を含む）を取り、`sourceRepoKey` で key にして封印 key と比べる。**物差し: 相手（会社・KanseiLINK）を責める判断は必ず正しい**（A・B が偽なら判断は会社側・KanseiLINK 側の穴になる）。したがって host の同一性（REPO_HOSTS の完全一致。GitHub だけ `www.github.com` も同じ host）と owner・repo の完全一致は崩さず、書き方の違いはすべて「載っている」: scheme は `https://`・`http://`・無し（`github.com/owner/repo`・`//github.com/…`）、ポートは無しか `:443` だけ、その下の path（`/tree/…`・`/blob/…`）・query・fragment・`.git`。`evilgithub.com`・`github.com.evil.example`・`gist.`／`api.` 等の別 host・`:443` 以外のポート・userinfo・別 owner・別 repo・`-v2`・`..`／`%2e` の dot segment・バックスラッシュ・URL 内の URL（`…?to=github.com/…`）は不一致（REPO 行の judge とは逆向きの寛容さ）。pass＝A1 または A2 に載っている。A1・A2 の個別の真偽は checks に残す。取得できないページがあり、かつ取得できたページのどれにも載っていないときだけ計器エラー。B＝`sealed_repo_vs_kansei_catalog`: 本番カタログの項（M-002 の読み取り・読むだけ）のどの欄かが同じ `sourceRepoKey` で封印 key を出せば pass。記録するのは欄の名前だけ（値は記録しない）。項が無い＝誤り、観測できない＝計器エラー。**改名検知**: 正解側の GitHub API で `full_name` が封印の owner/repo と違う（リダイレクト先の新しい名前）、`archived=true`、非公開、応答なしのどれかなら正解側は不整合。その日の判断は「未確定（計器）」で、AI の読みを外したと数えない。判断そのもの（真理表 #1–#8・未確定 U0–U4）は `lib/attribution-rules.mjs` の報告層の解釈で、表では「判断（規則 v0.1）」と札を付ける。台帳の事実ではない。回帰: `scripts/smoke-marker-attribution.mts`。
  - 回帰: `exec-harness/fixtures/llm-answer-cases.json`（二行形式のケースのみ・期待は排他）。旧い自由文のケース（C/A/X/R）と Codex の N/T 全文は `exec-harness/fixtures/evidence/` に証拠として保存し、判定対象から外す。

- ④ `catalog_display` の応答は**不在と表示の二つの排他的な形**として検証する（`classifyCatalogPayload`）。不在＝ちょうど `{code:"not_found", service_id:<要求 id>}` か `{error:"Service '<要求 id>' not found …"}`（表示欄を含まない）。表示＝`service_id` が要求 id と一致し、`mcp_status` と `freshness.confidence` が空でない（error／code 欄を含まない）。両方の情報がある・id が矛盾する・別の error が併存する・欄が欠ける・「not found」の部分一致だけ、はすべて**計器エラー**（観測ではない）。
- `fetch_check_summary`: `summary.date` に加えて `run_at` の日付、cell ごとの `date` も当日でなければ使わない（混在した summary は行を立てない／その cell は missing）。

共通の規律:
- 回答文・本文・URL は transcript.jsonl（git 外）にだけ残す。公開 bundle の checks は固定ラベル（service は番号で指す）。
- `--max-readings` は marker_id ごとに数える（`marker_readings` の有効な outcome 付き行）。観測者が複数の色素は taskpack の `max_readings` を観測者数×日数にする（M-003=14・M-004=28）。
- 偽の fixtures（M-994/995/996）・偽プロバイダ `fake`・`${ENV:…}` 置換は test-only＝非 dry-run を exit 5 で拒否。スモーク: `scripts/smoke-marker-{http-probe,fetch-check,llm-answer}.mts`。
- 罠（`--arm-trap`）は `mcp_direct_read` だけ。一般化した対象では `trap_armed=false` 固定。

- **reading.v1.1（2026-09-30・M-006）**: `target.setup`（`config_id`・`kind` api_tools/agent_cli・`provider`・`tools`・`prompt_variant`・`fetch_meaning`・`cli_version`）を任意項目として追加。method `natural_task_traces_vs_sealed_repo` の行では必須（`validateReading` の横断規則）。既存の行は変えずに有効。表の描画は setup を持つ行を「構成/変種→模型」で観測者として分け、構成の行を混ぜて数えない（構成ごとに「取得」の意味が違う）。
- **M-006 の隔離（agent_cli）**: Claude Code は空の `CLAUDE_CONFIG_DIR`・`--safe-mode`・`--strict-mcp-config` に空の MCP・`--tools WebSearch,WebFetch,Write`・`--permission-mode dontAsk`・`--no-session-persistence`・API キーだけで起動する。子プロセスの環境は**許す変数の一覧だけ**（`lib/natural-task.mjs` の `CLAUDE_CODE_ENV_INHERIT`＝API キー・OS の基本・proxy と、ハーネスが置く `CLAUDE_CODE_ENV_SET`＋`CLAUDE_CONFIG_DIR`。`process.env` 全体は継がない。変数の名前だけを manifest の `environment.child_env_names` に記録）。`system/init` がちょうど一つで、tools／mcp_servers／plugins が配列として在り、tools が許した三つに完全一致し、他の二つが空でなければ、その行は計器エラー（`agent_environment_isolated=false`）。欄の欠落・型違い・複数の init・想定外の道具はどれも計器。
- **M-004 の二行形式は記憶の基準線として残す（Michie 2026-09-29）**: 道具なし。Perplexity（sonar は常に検索する）を外して openai／gemini／claude の三行、週一回。

### 読みの表（`exec-harness/render-reading-sheet.mjs <marker_id>`）

台帳の有効行（supersedes に指されていない）から `founder-ops/research/Marker-<ID>_<日付>/SHEET.md` を描く。載せるのは主張・指紋・期間・観測者、一日一行（日付／観測者／到達／止まった臓器／判定／偽の完了／正解側の整合／証拠の指紋）、三つの数字（臓器別の停止日数・偽の完了の回数・計器の最終観測＝24h 超なら「不明」）。序列・得点・他ベンダーとの並置・対象の生値は載せない（禁止語と 8 桁以上の数字列を描画時に自己検査し、あれば描かずに落ちる）。スモーク: `scripts/smoke-render-sheet.mts`。

## 7. 変更履歴

- 2026-09-30 v1.1: `target.setup` を追加（M-006 の構成の明記）。`observed.method` に `natural_task_traces_vs_sealed_repo` を追加。§6 に `natural_task`（M-006）の行。M-004 は providers から perplexity を外し週一へ（記憶の基準線）。

- 2026-09-25 v1（追記）: 対象の一般化（§6）。`observer` パターンにエージェント CLI 形式を追加、`observed.method` に対象別の 5 値を追加。M-001 の経路・列・タスクは不変。

- 2026-09-24 v1 初版（Step 1 / HANDOFF T1）。Codex 審査 1 回目の対象。
