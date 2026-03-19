# Vercel デプロイガイド

このガイドでは、Lark MCP BotをVercelにデプロイする手順を説明します。

## 📋 前提条件

- ✅ Vercel Proプラン（60秒実行時間が必要）
- ✅ Upstash Redisアカウント（無料）
- ✅ Lark App設定済み
- ✅ GLM API Key取得済み

---

## 🚀 デプロイ手順

### Step 1: Upstash Redisのセットアップ

1. [Upstash Console](https://console.upstash.com/)にアクセス
2. "Create Database"をクリック
3. 以下を設定:
   - **Name**: `lark-mcp-bot`
   - **Region**: `Asia Pacific (ap-northeast-1 - Tokyo)` （最寄りのリージョン）
   - **Type**: `Regional` （低レイテンシー）
   - **Eviction**: `No Eviction` （会話履歴を保持）

4. 作成後、以下の情報をコピー:
   - `KV_REST_API_URL`
   - `KV_REST_API_READ_ONLY_TOKEN`

### Step 2: Vercelプロジェクトの作成

#### 方法A: Vercel CLI（推奨）

```bash
# Vercel CLIインストール（初回のみ）
npm install -g vercel

# ログイン
vercel login

# プロジェクトをVercelにリンク
vercel link

# 環境変数を設定
vercel env add LARK_APP_ID production
vercel env add LARK_APP_SECRET production
vercel env add GLM_API_KEY production
vercel env add GLM_API_BASE_URL production
vercel env add KV_REST_API_URL production
vercel env add KV_REST_API_READ_ONLY_TOKEN production
vercel env add LARK_OAUTH_REDIRECT_URI production

# ログ設定（オプション）
vercel env add LOG_LEVEL production
vercel env add ENABLE_PERFORMANCE_METRICS production

# MCP設定（オプション）
vercel env add ENABLED_TOOL_PREFIXES production
vercel env add DISABLED_TOOLS production

# デプロイ
vercel --prod
```

#### 方法B: Vercel Dashboard

1. [Vercel Dashboard](https://vercel.com/dashboard)にアクセス
2. "New Project"をクリック
3. GitHubリポジトリを選択（または手動アップロード）
4. 以下の環境変数を設定:

**必須**:
```
LARK_APP_ID=cli_xxxxxxxxxxxxxxxx
LARK_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GLM_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxx
GLM_API_BASE_URL=https://api.z.ai/api/coding/paas/v4
KV_REST_API_URL=https://xxxxxxxx.upstash.io
KV_REST_API_READ_ONLY_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LARK_OAUTH_REDIRECT_URI=https://your-project.vercel.app/auth/callback
```

**オプション**:
```
LOG_LEVEL=info
ENABLE_PERFORMANCE_METRICS=true
ENABLED_TOOL_PREFIXES=im.,contact.,drive.,calendar.
DISABLED_TOOLS=
```

5. "Deploy"をクリック

### Step 3: Lark App設定

1. デプロイ完了後、Vercel URLを取得:
   ```
   https://your-project.vercel.app
   ```

2. [Lark Developer Console](https://open.larksuite.com/app)にアクセス

3. アプリ設定 → イベント購読 → リクエストURL:
   ```
   https://your-project.vercel.app/webhook/event
   ```

4. イベントを購読:
   - `im.message.receive_v1` （必須 - メッセージ受信）

5. 権限設定:
   - メッセージ & グループ → すべて有効化
   - 連絡先 → 基本情報読み取り
   - ドキュメント → 読み取り（必要に応じて）
   - カレンダー → 読み取り（必要に応じて）

6. **OAuth設定**（ドキュメント検索・Wiki検索・カレンダー・タスクに必須）:
   - アプリ設定 → 「OAuth」タブ → 「有効化」
   - リダイレクトURI:
     ```
     https://your-project.vercel.app/auth/callback
     ```
   - スコープ（カンマ区切り）:
     ```
     drive:drive:readonly,wiki:wiki:readonly,calendar:calendar,calendar:calendar:readonly,calendar:calendar:update,calendar:calendar:create,calendar:calendar.event:read,task:task:read,task:task:write,task:tasklist:read,task:tasklist:write,offline_access
     ```
   - 「保存」をクリック

7. "発行"をクリックして変更を適用

---

## ✅ 動作確認

### 1. Vercelログ確認

```bash
vercel logs --follow
```

または Vercel Dashboard → Deployments → Logs

### 2. Larkでテスト

1. Larkグループにボットを追加
2. メンション付きでメッセージ送信:
   ```
   @bot こんにちは
   ```
3. ボットが応答すれば成功！

### 3. Redis動作確認

Upstash Console → Database → Dataタブで会話履歴を確認:
```
conversation:chat_xxxxx
timestamp:chat_xxxxx
```

---

## 🔧 トラブルシューティング

### ❌ ボットが応答しない

**原因1**: Webhook URLが正しく設定されていない
- Lark Developer Consoleで確認
- `https://your-project.vercel.app/webhook/event` が正確か

**原因2**: 環境変数が不足
```bash
# 環境変数を確認
vercel env ls
```

**原因3**: GLM API残高不足
- `GLM_API_BASE_URL` が Coding Plan 用エンドポイントか確認
  - Claude Code / Goose: `https://api.z.ai/api/anthropic`
  - その他ツール: `https://api.z.ai/api/coding/paas/v4`
- Coding Plan 対象外エンドポイントを使うと `1113` が発生する場合があります
- 必要に応じて [Zhipu AI Console](https://open.bigmodel.cn/) の残高も確認

### ❌ 会話コンテキストが保持されない

**原因**: Redisが正しく接続されていない

確認方法:
```bash
# Vercelログで確認
vercel logs | grep "Redis storage initialized"
```

修正:
1. Upstash環境変数を再確認
2. Redisデータベースが有効か確認

### ❌ タイムアウトエラー

**原因**: 実行時間が60秒を超えている

修正:
1. `vercel.json`の`maxDuration`を確認（Proプランで最大60秒）
2. MCPツールフィルタリングで不要なツールを削除:
   ```
   ENABLED_TOOL_PREFIXES=im.message.
   ```

---

## 📊 監視とメトリクス

### Vercelダッシュボード

- **実行時間**: Functions → Details
- **エラー率**: Deployments → Logs → Errors
- **リクエスト数**: Analytics → Functions

### Upstashダッシュボード

- **リクエスト数**: Database → Metrics
- **ストレージ使用量**: Database → Overview
- **レイテンシー**: Database → Metrics

### パフォーマンスログ

`ENABLE_PERFORMANCE_METRICS=true`の場合、各リクエストのメトリクスがログに出力:
```json
{
  "level": "info",
  "message": "Performance metric completed",
  "operation": "handle_message_receive",
  "duration_ms": 1250,
  "chatId": "chat_xxxxx"
}
```

---

## 🔄 更新とデプロイ

### 自動デプロイ（GitHub連携）

```bash
git add .
git commit -m "Update bot"
git push origin main
```

→ Vercelが自動的にデプロイ

### 手動デプロイ

```bash
vercel --prod
```

---

## 💰 コスト管理

### Upstash Redis（無料枠）

- **リクエスト**: 10,000/日
- **ストレージ**: 256MB
- **コマンド数**: 1,000,000/月

→ 通常の使用では無料枠内で収まります

### Vercel Pro

- **月額**: $20
- **実行時間**: 1,000 GB-Hours
- **転送量**: 1TB included

→ Lark Botとして十分な容量

---

## 🎯 本番運用のベストプラクティス

1. **エラーアラート設定**:
   - Vercel Integration: Slack/Discord通知
   - Upstash: Email通知

2. **ログレベル調整**:
   ```
   LOG_LEVEL=warn  # 本番環境
   LOG_LEVEL=info  # 開発環境
   ```

3. **会話履歴TTL**:
   - デフォルト: 1時間
   - 必要に応じてコード内の`CONVERSATION_TTL_MS`を調整

4. **定期的な監視**:
   - 週1回: Vercel使用量確認
   - 月1回: Upstash使用量確認
   - エラーログのレビュー

---

## 🆘 サポート

- **Vercel**: https://vercel.com/support
- **Upstash**: https://upstash.com/docs
- **Lark**: https://open.larksuite.com/document/

---

**実装完了日**: 2026-01-24  
**対応バージョン**: Vercel Pro + Upstash Redis
