# fixtures/synthetic — 合成データの隔離置き場（P0 #39）

ここにあるデータは **outcomes プールから合成された synthetic データ**（`agent_id: kansei-link-synth` /
"succeeds on N% of calls" 型の実名×合成数値）です。**公開 package・`src/data/`・`dist/` へ
コピー/移動することを恒久的に禁止します**（pack-gate G1/G5 が tarball 混入を検知して publish を
ブロックし、`scripts/lib-synth-guard.mjs` が生成スクリプトの出力先をこのディレクトリ内に制限します）。

- `voices-seed.fixture.json` — **完全匿名の合成データ207行**（`Fixture Service N` のみ・実サービス名ゼロ。
  旧 `src/data/voices-seed.json` と同形式・同行数で、G1検出パターン文言
  "succeeds on N% of calls" / "kansei-link-synth" を意図的に保持）
- `service-stats-seed.fixture.json` — 同・完全匿名の合成1,019行

⚠️ Checker監査P0-1（2026-08-16）により、実サービス名入りの退避データは**コミット禁止**
（public repoへのコミット自体が再公開になるため）。実名版が必要な場合はコミットせず
`--fixture-out` でその都度ローカル生成すること（それがこの仕組みの設計意図）。

用途: 否定テスト（`scripts/smoke-dist-hygiene.mjs` が「fixture を src/data へコピーすると
pack-gate が FAIL する」ことの検証に使用）およびローカル開発での合成データ実験。

新しい合成 fixture を作る場合:

```bash
node scripts/aggregate-voices.mjs --fixture-out fixtures/synthetic/<name>.json
node scripts/export-stats-seed.mjs --fixture-out fixtures/synthetic/<name>.json
```

`--fixture-out` なしでは両スクリプトともデフォルト拒否（exit 1）。出力先が
`fixtures/` 外（特に `src/data/`・`dist/`）の場合も即時 FAIL します。

このディレクトリは `package.json` の `files` allowlist に含まれず（=npm 配布物に載らず）、
pack-gate は万一 tarball に `fixtures/` が現れた場合も G5 で FAIL します。
