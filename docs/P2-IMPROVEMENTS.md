# P2改善実装ガイド

## 概要

P2改善項目（MCPツールフィルタリング、エラーハンドリング強化、ロギング改善）がすべて実装されました。

## 実装内容

### 1. MCPツールのフィルタリング

**機能**: 不要なMCPツールを除外してパフォーマンスとコスト削減

**設定方法**: `.env`ファイルに以下を追加

```bash
# MCPツールフィルタリング設定

# 有効化するツールのプレフィックス（カンマ区切り、空 = 全て有効）
ENABLED_TOOL_PREFIXES=im.,contact.,drive.,calendar.

# 明示的に無効化するツール（カンマ区切り）
DISABLED_TOOLS=
```

**デフォルト動作**:
- `ENABLED_TOOL_PREFIXES`: `im.`, `contact.`, `drive.`, `calendar.` で始まるツールのみ有効
- `DISABLED_TOOLS`: なし（空文字列）

**例**:
```bash
# メッセージ関連のみ有効化
ENABLED_TOOL_PREFIXES=im.message.

# 特定ツールを無効化
DISABLED_TOOLS=im.chat.delete,im.message.delete
```

### 2. エラーハンドリングの強化

**実装内容**:
- カスタムエラークラスの拡張
  - `RateLimitError`: レート制限エラー（429）
  - `ValidationError`: バリデーションエラー
  - 各エラーに`toUserMessage()`メソッドでユーザー向けメッセージ生成
  - `statusCode`プロパティ追加でHTTPステータス管理

- リトライロジック改善
  - エラー種別による自動判定（リトライ可能/不可能）
  - 指数バックオフ（1秒、2秒、4秒）
  - ネットワークエラー、5xx エラーは自動リトライ
  - 認証エラー（401/403）、バリデーションエラー（400）はリトライしない

- LLM APIエラーハンドリング
  - レート制限の自動検出と専用エラーメッセージ
  - トークン使用量のメトリクス記録

**ユーザー向けエラーメッセージ例**:
- Rate Limit: 「申し訳ありません。現在リクエストが集中しています。しばらく待ってからお試しください。」
- 認証エラー: 「申し訳ありません。認証エラーが発生しました。管理者に連絡してください。」
- ツール実行エラー: 「申し訳ありません。ツール「xxx」の実行中にエラーが発生しました。」

### 3. ロギングの改善

**実装内容**:
- 構造化ログシステム（`src/utils/logger.ts`）
- ログレベル設定（debug, info, warn, error）
- パフォーマンスメトリクス自動計測
- JSON形式の出力

**設定方法**: `.env`ファイルに以下を追加

```bash
# ロギング設定

# ログレベル (debug/info/warn/error)
LOG_LEVEL=info

# パフォーマンスメトリクス有効化 (true/false)
ENABLE_PERFORMANCE_METRICS=true
```

**デフォルト動作**:
- `LOG_LEVEL`: `info`（info以上のログを出力）
- `ENABLE_PERFORMANCE_METRICS`: `true`（メトリクス計測有効）

**出力例**:
```json
{
  "timestamp": "2026-01-24T11:52:14.222Z",
  "level": "info",
  "message": "MCP tools filtered",
  "totalTools": 50,
  "filteredTools": 12,
  "enabledPrefixes": ["im.", "contact."],
  "disabledTools": []
}

{
  "timestamp": "2026-01-24T11:52:15.450Z",
  "level": "info",
  "message": "Performance metric completed",
  "metricId": "handle_message_chat123_1234567890",
  "operation": "handle_message_receive",
  "duration_ms": 1228,
  "chatId": "chat123",
  "userId": "user456"
}
```

**メトリクス計測対象**:
- `handle_message_receive`: メッセージ処理全体
- `llm_completion`: LLM API呼び出し
- `llm_followup_completion`: ツール実行後のフォローアップLLM呼び出し
- `execute_tool_*`: 個別ツール実行
- `send_message`: Lark APIメッセージ送信

### 4. ログレベルの使い分け

- **debug**: 詳細なデバッグ情報（会話履歴クリーンアップ、リトライ遅延など）
- **info**: 通常の動作ログ（メッセージ受信、ツール実行、応答送信）
- **warn**: 警告（リトライ試行、ツールバリデーション失敗）
- **error**: エラー（API失敗、ツール実行エラー、メッセージ送信失敗）

## 環境変数まとめ

`.env`ファイルに以下を追加してください：

```bash
# === ロギング設定 ===
LOG_LEVEL=info
ENABLE_PERFORMANCE_METRICS=true

# === MCPツールフィルタリング ===
ENABLED_TOOL_PREFIXES=im.,contact.,drive.,calendar.
DISABLED_TOOLS=
```

## テスト結果

全65テストが成功:
- `tests/types.test.ts`: 10テスト（新しいエラークラスのテスト追加）
- `tests/config.test.ts`: 10テスト
- `tests/glm-client.test.ts`: 16テスト
- `tests/bot.test.ts`: 18テスト
- `tests/integration.test.ts`: 11テスト

## パフォーマンス改善

1. **MCPツールフィルタリング**:
   - 全ツール（50+）から必要なツール（10-15）に絞ることで、LLM APIのペイロードサイズを削減
   - トークン使用量とコスト削減
   - 応答速度向上

2. **エラーハンドリング**:
   - 不要なリトライを回避（401/403/400エラー）
   - レート制限の早期検出で無駄なAPI呼び出し削減

3. **ロギング**:
   - パフォーマンスボトルネックの可視化
   - トラブルシューティング時間の短縮

## 次のステップ（オプション）

以下の追加改善を検討できます：

1. **ログ集約**: CloudWatch、Datadog、Sentryなどへのログ送信
2. **アラート**: エラー率、レスポンス時間の閾値監視
3. **メトリクスダッシュボード**: Grafana等での可視化
4. **レート制限対策**: バックオフ時間の動的調整
5. **キャッシング**: よく使うツール定義のキャッシュ

---

**実装完了日**: 2026-01-24  
**テスト状況**: ✅ 全テスト通過（65/65）  
**ビルド状況**: ✅ 成功
