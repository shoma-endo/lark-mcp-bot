# Lark MCP AI Agent Bot

Lark（Feishu）のテナント内をMCP（Model Context Protocol）経由で自由自在に操るAIエージェントボットです。GLM-4.7をLLMとして使用します。

## 🎯 特徴

- **Lark API統合**: `@larksuiteoapi/node-sdk`を使用した完全なLark APIアクセス
- **MCPツール統合**: `@larksuiteoapi/lark-mcp`による100+のLark APIツールをGLM-4.7のFunction Callingに変換
- **GLM-4.7連携**: Zhipu AIのGLM-4.7モデルによる高精度な応答生成と自動的なツール選択
- **会話履歴管理**: チャットごとのコンテキスト保持（最大30メッセージ）
- **エラーハンドリング**: 自動リトライ・構造化ログ・適切なエラーメッセージ

## 📋 できること

| 機能 | 説明 |
|------|------|
| メッセージ送信 | チャットにテキストメッセージを送信 |
| メッセージ検索 | チャット内のメッセージを検索・要約 |
| チャット管理 | グループチャットの作成・情報取得 |
| ユーザー情報 | ユーザー情報の取得 |
| ドキュメント読み取り | Larkドキュメントの内容取得 |
| Bitable操作 | Baseのレコード検索・作成・更新 |

## 🏗️ アーキテクチャ

### 全体構成

```mermaid
graph TB
    subgraph "External Services"
        LarkAPI["Lark Open Platform"]
        GLM["GLM-4.7<br/>(Zhipu AI)"]
        Redis["Upstash Redis"]
    end

    subgraph "Entry Points"
        Local["Local Server<br/>:3000/webhook/event"]
        Vercel["Vercel Serverless<br/>api/webhook.ts"]
    end

    subgraph "Core System"
        ED["EventDispatcher<br/>im.message.receive_v1"]
        Bot["LarkMCPBot"]
        MCP["MCP Tool Layer<br/>100+ Lark API Tools"]
        Storage["ConversationStorage"]
    end

    subgraph "Storage Backends"
        Mem["MemoryStorage<br/>(開発用)"]
        RedisStore["RedisStorage<br/>(本番用)"]
    end

    LarkAPI -- "Webhook Event" --> Local
    LarkAPI -- "Webhook Event" --> Vercel
    Local --> ED
    Vercel --> ED
    ED --> Bot
    Bot -- "Function Calling" --> GLM
    Bot -- "Tool実行" --> MCP
    MCP -- "API Call" --> LarkAPI
    Bot --> Storage
    Storage --> Mem
    Storage --> RedisStore
    RedisStore --> Redis
    Bot -- "応答送信" --> LarkAPI
```

### メッセージ処理シーケンス

ユーザーがLarkでボットにメンションしてから応答が返るまでの流れ:

```mermaid
sequenceDiagram
    participant U as Larkユーザー
    participant L as Lark API
    participant W as Webhook<br/>(Local/Vercel)
    participant B as LarkMCPBot
    participant S as Storage<br/>(Redis/Memory)
    participant G as GLM-4.7
    participant M as MCP Tools

    U->>L: @bot メッセージ送信
    L->>W: im.message.receive_v1
    W->>B: handleMessageReceive()

    B->>S: getHistory(chatId)
    S-->>B: 会話履歴

    B->>G: chat.completions.create()<br/>(messages + tools定義)

    alt Tool呼び出しが必要な場合
        G-->>B: tool_calls: [{name, arguments}]
        B->>M: executeToolCall()
        M->>L: Lark API実行
        L-->>M: API結果
        M-->>B: ツール実行結果
        B->>G: 再度呼び出し(ツール結果付き)
        G-->>B: 最終応答テキスト
    else 直接応答の場合
        G-->>B: 応答テキスト
    end

    B->>S: setHistory(chatId, messages)
    B->>L: sendMessage(応答)
    L->>U: ボット応答表示
```

### エラーハンドリング階層

```mermaid
graph TD
    Base["LarkBotError<br/>(基底クラス)"]
    Base --> LLM["LLMError<br/>リトライ可 / 429検知"]
    Base --> Tool["ToolExecutionError<br/>リトライ不可"]
    Base --> API["LarkAPIError<br/>リトライ可 / 認証・ネットワーク"]
    Base --> Rate["RateLimitError<br/>リトライ可 / 429"]
    Base --> Res["ResourcePackageError<br/>GLM残高不足"]
    Base --> APIRate["APIRateLimitError<br/>API同時実行制限"]
    Base --> Val["ValidationError<br/>入力バリデーション"]

    style Base fill:#f9f,stroke:#333
    style LLM fill:#ff9,stroke:#333
    style Rate fill:#ff9,stroke:#333
    style API fill:#ff9,stroke:#333
    style Tool fill:#f99,stroke:#333
    style Res fill:#f99,stroke:#333
    style Val fill:#f99,stroke:#333
    style APIRate fill:#ff9,stroke:#333
```

### Miyabi Agent ワークフロー（自律開発パイプライン）

GitHub Issueの作成からデプロイまでの自律型開発フロー:

```mermaid
sequenceDiagram
    participant H as 人間
    participant I as IssueAgent
    participant C as CoordinatorAgent
    participant CG as CodeGenAgent
    participant R as ReviewAgent
    participant T as TestAgent
    participant PR as PRAgent
    participant D as DeploymentAgent

    H->>I: Issue作成
    I->>I: 65ラベル体系で自動分類<br/>(type/priority/complexity)
    I->>C: ラベル付きIssue

    C->>C: DAGベースでタスク分解<br/>Critical Path特定
    C->>CG: タスク割当

    CG->>CG: コード生成 + テスト生成<br/>(TypeScript strict mode)
    CG->>R: コード提出

    R->>R: 静的解析・セキュリティスキャン<br/>品質スコアリング

    alt スコア < 80点
        R-->>CG: 差し戻し(修正指示)
        CG->>R: 修正コード再提出
    end

    R->>T: 品質合格(≥80点)
    T->>T: テスト実行<br/>カバレッジ確認

    alt カバレッジ < 80%
        T-->>CG: テスト追加要求
        CG->>T: テスト追加
    end

    T->>PR: テスト合格
    PR->>PR: Draft PR自動作成<br/>(Conventional Commits準拠)
    PR->>H: レビュー依頼

    H->>D: PR マージ
    D->>D: 自動デプロイ<br/>ヘルスチェック

    alt ヘルスチェック失敗
        D->>D: 自動Rollback
        D->>H: エスカレーション通知
    end
```

## 🚀 セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env`ファイルを編集します：

```env
# Lark App Credentials
LARK_APP_ID=your_app_id_here
LARK_APP_SECRET=your_app_secret_here

# Lark API Domain
LARK_DOMAIN=https://open.feishu.cn

# GLM-4.7 API Key (Zhipu AI)
GLM_API_KEY=your_glm_api_key_here
GLM_API_BASE_URL=https://api.z.ai/api/paas/v4
GLM_MODEL=glm-4.7

# Server Configuration
PORT=3000
WEBHOOK_PATH=/webhook/event
```

### 3. Larkアプリの設定

1. [Lark Open Platform](https://open.feishu.cn/) でアプリを作成
2. `APP_ID` と `APP_SECRET` を取得
3. 必要な権限を付与：
   - `im:message` （メッセージ送信・受信）
   - `im:chat` （チャット情報取得）
   - `contact:user.base:readonly` （ユーザー情報取得）
   - `docx:document` （ドキュメント読み取り）
   - `bitable:app` （Base操作）

## 🏃 実行

### 開発モード

```bash
npm run dev
```

### ビルド

```bash
npm run build
```

### 本番実行

```bash
npm start
```

## 📁 プロジェクト構造

```
lark-mcp-bot/
├── src/
│   ├── bot/
│   │   └── index.ts       # メインボットロジック（MCP統合・Function Calling）
│   ├── config.ts          # 設定管理
│   ├── types.ts           # 型定義
│   └── index.ts           # HTTPサーバー・Webhookエンドポイント
├── tests/
│   ├── bot.test.ts        # ユニットテスト
│   ├── integration.test.ts # 統合テスト
│   └── setup.ts         # テスト共通設定
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .env               # 環境変数（.gitignore済み）
```

## 🔌 MCPツール

ボットは以下のMCPツールを提供します：

| ツール名 | 説明 |
|---------|------|
| `lark_send_message` | チャットにメッセージを送信 |
| `lark_list_messages` | チャットのメッセージ一覧を取得 |
| `lark_get_chat` | チャット情報を取得 |
| `lark_create_chat` | 新しいグループチャットを作成 |
| `lark_get_user` | ユーザー情報を取得 |
| `lark_get_document` | ドキュメントの内容を取得 |
| `lark_search_bitable` | Baseのレコードを検索 |
| `lark_create_bitable_record` | Baseにレコードを作成 |
| `lark_update_bitable_record` | Baseのレコードを更新 |

## 💬 使用例

### Larkチャットでボットに話しかける

Larkでボットにメンションして会話します。ボットはGLM-4.7であなたのリクエストを解析し、適切なLark APIを自動的に実行します。

```
ユーザー: @bot こんにちは！
ボット: こんにちは！私はLarkのAIアシスタントボットです。メッセージ検索、ドキュメント読み取り、Base操作などができます。

ユーザー: @bot 最近のメッセージを要約して
ボット: [最近のメッセージの要約を表示]

ユーザー: @bot 新しいグループを作成して
ボット: グループ名と参加メンバーを教えてください。

ユーザー: @bot チャット一覧見せて
ボット: [チャット一覧を表示]

ユーザー: @bot Bitableにレコード追加して
ボット: どのBaseのどのテーブルに追加しますか？
```

## 🧪 テスト

### ユニットテスト

個々のコンポーネントのテスト：

```bash
npm test
```

### 統合テスト

エンドツーエンドのメッセージフローのテスト：

```bash
npm test -- tests/integration.test.ts
```

### カバレッジ

カバレッジレポートを表示：

```bash
npm run test:coverage
```

目標: 80%以上のカバレッジ

## 🔧 トラブルシューティング

### GLM API残高不足

ボットが応答しない場合、GLM API残高が不足している可能性があります。以下の手順で確認してください：

1. [Zhipu AI Open Platform](https://open.bigmodel.cn/) にアクセス
2. API残高を確認
3. 必要に応じてチャージする

### GLM APIキーの取得

1. [Zhipu AI Open Platform](https://open.bigmodel.cn/) にアクセス
2. アカウントを作成・ログイン
3. API Keyを発行
4. `.env`ファイルに設定

### テストが失敗する場合

```bash
# モックをクリアして再実行
npm test -- --run

# デバッグモードで実行
npm test -- --reporter=verbose
```

## 📄 ライセンス

MIT License

## 🙏 参考リンク

- [Lark Open Platform](https://open.feishu.cn/)
- [Zhipu AI GLM-4.7](https://docs.z.ai/guides/llm/glm-4.7)
- [Model Context Protocol](https://modelcontextprotocol.io/)
