# MCP Server構築入門 — 2026年最新の作り方ガイド

**発行:** KanseiLink / Synapse Arrows PTE. LTD.
**公開日:** 2026-04-08
**著者:** KanseiLink編集部
**タグ:** Technical Guide

---

## TL;DR（この記事の要点）

- MCP（Model Context Protocol）はAnthropicが2024年11月に公開したオープン規格であり、2026年4月現在、Claude、Cursor、Windsurf、VS Code（GitHub Copilot）など主要AIツールが対応済み
- MCP Server構築はTypeScriptが最も成熟しており、公式SDKとテンプレートを使えば30分でローカル動作するサーバーを立ち上げ可能
- 日本のSaaS連携では認証・レートリミット・日本語エラーメッセージ設計が実運用上の最大のハードル
- kintone、Backlog、freeeなど日本発SaaSへの接続は、公式MCPが未提供のケースが多く自前構築またはコミュニティ製サーバー活用が現実解

---

## はじめに

2026年、AIエージェントが業務システムを横断的に操作する光景は珍しくなくなった。その中核インフラとして急速に標準化が進んでいるのが、Anthropicが提唱するMCP（Model Context Protocol）である。MCPはAIモデルと外部ツール・データソースを「サーバー／クライアント」の形式で接続するオープン規格だ。日本企業においても、kintoneやfreee、Backlogといった国産SaaSとAIエージェントの連携ニーズが高まっており、MCP Server構築のスキルはエンジニアにとって必須となりつつある。本記事では、MCP Serverをゼロから作る手順を、TypeScriptを中心にPython・Goも含めて解説する。

---

## MCPの基本アーキテクチャを理解する

MCP Serverの作り方を学ぶ前に、アーキテクチャを整理しておこう。MCPは以下の3層構造で設計されている。

### ホスト・クライアント・サーバーの関係

- **ホスト:** Claude Desktop、Cursor、Windsurfなど、ユーザーが操作するAIアプリケーション本体
- **クライアント:** ホスト内部でMCPサーバーとの通信を担うコンポーネント（1クライアント：1サーバーの関係）
- **サーバー:** 外部システムのAPIやデータベースへアクセスし、Tools / Resources / Prompts を提供する軽量プロセス

この構造により、AIモデルは直接外部システムにアクセスせず、MCPサーバー経由で安全に操作を行う。日本企業が懸念するセキュリティ・監査ログの要件も、サーバー層で制御できる点が導入を後押ししている。

---

## TypeScriptでMCP Serverを構築する手順

2026年4月時点で最も成熟しているのは公式TypeScript SDKだ。MCP入門として、ここから始めることを推奨する。

### 環境準備

```bash
node -v  # v18以上を確認
npm install -g @anthropic-ai/create-mcp-server
```

### プロジェクト作成

```bash
npx @anthropic-ai/create-mcp-server my-mcp-server
cd my-mcp-server
npm install
```

公式テンプレートには、Tools・Resources・Promptsの実装サンプルが含まれている。

### Toolの実装例

以下は、kintone REST APIを呼び出して顧客情報を取得するToolの骨格だ。

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({
  name: "kintone-connector",
  version: "1.0.0",
});

server.setRequestHandler("tools/list", async () => ({
  tools: [
    {
      name: "get_customer",
      description: "kintoneから顧客情報を取得します",
      inputSchema: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "顧客ID" },
        },
        required: ["customer_id"],
      },
    },
  ],
}));

server.setRequestHandler("tools/call", async (request) => {
  if (request.params.name === "get_customer") {
    // kintone API呼び出し（認証トークンは環境変数から取得）
    const result = await fetchKintoneCustomer(request.params.arguments.customer_id);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

### ビルドと動作確認

```bash
npm run build
npx @anthropic-ai/mcp-inspector dist/index.js
```

MCP Inspectorを使えば、ブラウザ上でToolの呼び出しテストが可能だ。

---

## Python・GoによるMCP Server構築

TypeScript以外にも選択肢がある。チームのスキルセットに応じて使い分けたい。

| 言語 | SDK成熟度 | 推奨ユースケース | 備考 |
|------|----------|-----------------|------|
| TypeScript | ◎ | フロントエンド連携、Node.js資産活用 | 公式テンプレート・Inspector完備 |
| Python | ○ | データ分析、ML連携、既存Pythonシステム | FastMCP等のラッパーあり |
| Go | △ | 高パフォーマンス、インフラ系ツール | コミュニティ主導、SDK安定途上 |

### Python（FastMCP）での最小実装

```python
from fastmcp import FastMCP

mcp = FastMCP("demo-server")

@mcp.tool()
def greet(name: str) -> str:
    """挨拶を返す"""
    return f"こんにちは、{name}さん"

if __name__ == "__main__":
    mcp.run()
```

Pythonはデコレータベースで記述量が少なく、MCPチュートリアルとしても取り組みやすい。

---

## 日本SaaS連携における実装上の注意点

海外SaaSと比較して、日本のSaaS連携には固有の課題がある。

### 認証方式の多様性

kintoneはAPIトークン認証、freeeはOAuth 2.0、BacklogはAPIキーとOAuth両対応と、認証方式がバラバラだ。MCP Serverを構築する際は、認証情報を環境変数で管理し、サーバー起動時に検証する設計が必須となる。

### エラーメッセージの日本語対応

AIエージェントが日本語でユーザーに説明できるよう、エラーレスポンスは日本語で返す設計を推奨する。APIエラーをそのまま返すと、英語のエラーコードだけが表示されユーザー体験が損なわれる。

### レートリミット設計

kintoneは1分あたり1,000リクエスト、freee会計は1時間あたり3,600リクエストといった制限がある。エージェントが連続操作を行う場合、サーバー側でリトライロジックとバックオフを実装しておくことで、429エラーを回避できる。

### 公式MCP提供状況（2026年4月時点）

2026年4月時点で、kintone、freee、SmartHR、Backlog、Chatworkはいずれも公式MCPを発表していない。Slack、Notion、GitHub、Stripeは公式・コミュニティ製サーバーがmcp.soやGitHubで公開されている。日本SaaSに接続したい場合、自前でMCP Serverを構築するか、コミュニティ製を活用し検証する必要がある。

---

## Claude Desktopへの組み込みとデバッグ

構築したMCP Serverを実際にAIエージェントから使うには、ホストアプリケーションへ登録する。

### Claude Desktopの設定例（macOS）

`~/Library/Application Support/Claude/claude_desktop_config.json` を編集する。

```json
{
  "mcpServers": {
    "kintone-connector": {
      "command": "node",
      "args": ["/path/to/my-mcp-server/dist/index.js"],
      "env": {
        "KINTONE_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

設定後、Claude Desktopを再起動すれば、チャット画面からToolが呼び出せるようになる。

### デバッグのポイント

- `console.error` で標準エラー出力にログを出すと、ホストアプリ側でキャプチャ可能
- MCP Inspectorでリクエスト／レスポンスを可視化し、スキーマ不一致を検出
- 本番運用前にレートリミットとエラーハンドリングを徹底テスト

---

## まとめ

MCP Server構築は、AIエージェント経済においてSaaSとAIを橋渡しする中核スキルだ。TypeScriptを使えば公式SDKの恩恵を最大限に受けられ、30分でローカル動作するプロトタイプを作成できる。Python・Goも選択肢に入るが、SDK成熟度を考慮して使い分けてほしい。

日本SaaSとの連携においては、認証方式の多様性、日本語エラーメッセージ、レートリミット対策が実運用上の肝となる。2026年4月時点でkintone、freee、BacklogなどはMCP公式対応が未発表であり、自前構築またはコミュニティ製サーバーの検証が現実解だ。

エージェント運用担当者は、まず社内で使用頻度の高いSaaSを1つ選び、MCP Serverを構築して小さく検証を始めることを推奨する。その経験が、今後のAIエージェント運用基盤を築く土台となる。

---

## FAQ

**Q1. MCP Serverを本番環境で運用する際のセキュリティ対策は？**
A. 認証情報は必ず環境変数または専用のシークレット管理サービス（AWS Secrets Manager、HashiCorp Vaultなど）で管理し、コードにハードコードしない。また、MCP Serverはローカルプロセスとして動作させ、外部ネットワークに直接公開しない設計が基本だ。アクセスログを記録し、異常な呼び出しパターンを検知できる監視体制も整えておきたい。

**Q2. kintoneやfreeeの公式MCPが出るまで待つべきか？**
A. 2026年4月時点で公式リリースの発表はないため、待つ間に自前構築で知見を蓄積することを推奨する。公式MCPがリリースされた場合も、既存のREST API知識やエラーハンドリング設計は流用できる。むしろ先行して構築した経験があれば、公式版への移行もスムーズに行える。

**Q3. MCP ServerとLangChain / LlamaIndexの違いは？**
A. LangChainやLlamaIndexはAIアプリケーション構築フレームワークであり、プロンプトチェーンやRAGパイプラインを構築する際に使う。MCPはAIモデルと外部ツールを接続する「通信規格」であり、フレームワークではなくインターフェース標準だ。両者は競合ではなく補完関係にあり、LangChain内からMCPサーバーを呼び出す構成も可能である。

---

## 関連リンク

- [KanseiLINK MCPサーバー](https://github.com/kansei-link/kansei-mcp-server)
- [AEOランキング Q2 2026](https://kansei-link.com/articles/aeo-ranking-q2-2026)

*この記事はKanseiLINK編集ポリシーに基づき、AIエージェント経済における日本SaaSの実態を継続取材しています。*
