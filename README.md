# Lark MCP AI Agent Bot

Lark（Feishu）のテナント内をMCP（Model Context Protocol）経由で自由自在に操るAIエージェントボットです。GLM-4.7をLLMとして使用します。

## 🎯 特徴

- **Lark API統合**: `@larksuiteoapi/node-sdk`を使用した完全なLark APIアクセス
- **MCPサーバー**: Larkの機能をMCPツールとして公開
- **GLM-4.7連携**: Zhipu AIのGLM-4.7モデルによる高精度な応答生成
- **WebSocket長接続**: ファイアウォール設定不要のローカル開発対応
- **会話履歴管理**: チャットごとのコンテキスト保持

## 📋 できること

| 機能 | 説明 |
|------|------|
| メッセージ送信 | チャットにテキストメッセージを送信 |
| メッセージ検索 | チャット内のメッセージを検索・要約 |
| チャット管理 | グループチャットの作成・情報取得 |
| ユーザー情報 | ユーザー情報の取得 |
| ドキュメント読み取り | Larkドキュメントの内容取得 |
| Bitable操作 | Baseのレコード検索・作成・更新 |

## 🚀 セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env`ファイルを編集します：

```env
# Lark App Credentials
LARK_APP_ID=cli_a8dd15cc74f8d02d
LARK_APP_SECRET=Vmntc3dthwWdeN0HPY4dxdTQiBIQw6he

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
│   │   └── index.ts       # メインボットロジック
│   ├── lark/
│   │   └── client.ts      # Lark APIクライアント
│   ├── glm/
│   │   └── client.ts      # GLM-4.7 APIクライアント
│   ├── mcp/
│   │   └── server.ts      # MCPサーバー
│   ├── config.ts          # 設定管理
│   └── index.ts           # エントリーポイント
├── package.json
├── tsconfig.json
└── .env
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

### チャットでボットに話しかける

```
ユーザー: こんにちは！
ボット: こんにちは！私はLarkのAIアシスタントボットです。メッセージ検索、ドキュメント読み取り、Base操作などができます。

ユーザー: 最近のメッセージを要約して
ボット: [最近のメッセージの要約を表示]

ユーザー: 新しいグループを作成して
ボット: グループ名と参加メンバーを教えてください。
```

### プログラムからMCPツールを使用

```typescript
import { LarkMCPBot } from './src/bot/index.js';

const bot = new LarkMCPBot();

// メッセージを送信
await bot.executeMCPTool('lark_send_message', {
  chat_id: 'oc_xxxxxxxxx',
  text: 'こんにちは！'
});

// メッセージ一覧を取得
const messages = await bot.executeMCPTool('lark_list_messages', {
  chat_id: 'oc_xxxxxxxxx',
  limit: 20
});
```

## 🔧 トラブルシューティング

### WebSocket接続が失敗する場合

ファイアウォールやネットワーク設定によりWebSocket接続ができない場合、HTTP Webhookモードにフォールバックします。その場合は、Lark管理画面でイベント購読のURLを設定してください。

### GLM APIキーの取得

1. [Zhipu AI Open Platform](https://open.bigmodel.cn/) にアクセス
2. アカウントを作成・ログイン
3. API Keyを発行
4. `.env`ファイルに設定

## 📄 ライセンス

MIT License

## 🙏 参考リンク

- [Lark Open Platform](https://open.feishu.cn/)
- [Zhipu AI GLM-4.7](https://docs.z.ai/guides/llm/glm-4.7)
- [Model Context Protocol](https://modelcontextprotocol.io/)
