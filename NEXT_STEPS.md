# Lark MCP Bot - Next Steps

## プロジェクト概要

- **目的**: Lark内でMCPツールを使ってLark APIを操作するAIボット
- **技術スタック**:
  - Node.js + TypeScript
  - Lark SDK (`@larksuiteoapi/node-sdk`)
  - MCP (`@larksuiteoapi/lark-mcp`)
  - LLM: GLM-4.7 (Zhipu AI)

## 実装済み機能

### ✅ MCP統合
- `LarkMcpTool`でLark MCPツールを取得
- GLM-4.7 Function Calling形式に変換
- 100+のLark APIツールが利用可能

### ✅ Function Calling対応
- GLM-4.7の`tools`パラメータに対応
- ツール実行 → 結果をLLMに渡して応答生成
- 会話履歴管理（最大30メッセージ）

### ✅ ローカル実行
- HTTPサーバー (ポート3000)
- Cloudflare Tunnelで公開

## 環境設定

```bash
# .env ファイル
LARK_APP_ID=cli_a8dd15cc74f8d02d
LARK_APP_SECRET=Vmntc3dthwWdeN0HPY4dxdTQiBIQw6he
GLM_API_KEY=<your-key>
```

## 起動方法

```bash
# 1. ビルド
npm run build

# 2. ボット起動
npm start

# 3. Cloudflare Tunnel (別ターミナル)
npx cloudflared tunnel --url http://localhost:3000
```

表示されたURLをLark管理画面のEvent Settings → Request URLに設定

---

## 次回のアクション

### 1. 固定URLの検討

| 方法 | URL | 価格 | 優先度 |
|------|-----|------|--------|
| Cloudflare Tunnel + 無料ドメイン | 固定 | 無料 | 🔴 手間が必要 |
| ngrok無料 | 変動 | 無料 | 🟡 開発中にOK |
| ngrok有料 | 固定 | $8/月 | 🟢 最も簡単 |

**推奨**: まずはngrok無料で開発を進める

```bash
# ngrokの場合
brew install ngrok
ngrok http 3000
```

### 2. GLM API残高の確認

- エラー: `429` (残高不足)
- APIキーをチャージする必要あり

### 3. MCPツールのフィルタリング（オプション）

現在は100+ツールが全て登録されています。必要に応じて絞り込み:

```typescript
// src/bot/index.ts
this.mcpTool = new LarkMcpTool({
  // ...
  toolsOptions: {
    language: 'en',
    allowTools: ['im.message.create', 'bitable.appTableRecord.list'], // 必要なツールのみ
  },
}, undefined);
```

### 4. テスト

ボットにメンションして動作確認:

```
@bot 今日の天気は？
@bot チャット一覧見せて
@bot Bitableのレコードを追加して
```

---

## ファイル構成

```
lark-mcp-bot/
├── src/
│   ├── bot/index.ts      # MCP統合済みボット
│   ├── config.ts         # 環境変数設定
│   └── index.ts          # HTTPサーバー
├── dist/                 # ビルド出力
├── .env                  # 環境変数（gitignore済み）
└── package.json
```

---

## 関連リンク

- Lark開発者: https://open.feishu.cn/
- GLM-4.7 API: https://docs.z.ai/
- Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps
