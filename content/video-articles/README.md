# Video article generator

1. `_template.json` をコピーし、先頭の `_` を外したファイル名で保存する。
2. `videoId` は `content/video-insights.json` に登録済みの長尺動画IDを使う。
3. `transcript` は動画の自社ナレーション全文を段落ごとに格納する。
4. `sources` には主張を支える一次情報・公式情報だけを入れる。
5. `npm run videos:generate` を実行する。

生成物には、軽量クリック再生、Article・VideoObject・FAQPage構造化データ、結論、要点、全文文字起こし、出典が含まれる。先頭が `_` のJSONはテンプレートとして無視される。
