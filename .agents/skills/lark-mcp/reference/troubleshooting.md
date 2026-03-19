# トラブルシューティング

## エラークイックリファレンス

| エラー | 原因 | 解決策 |
|--------|------|--------|
| tool not found | サーバー名が間違っている | `mcp__lark-mcp__` プレフィックスを使用 |
| 99991663 | 権限不足 | `useUAT: true` またはOAuthを設定 |
| 131005 | token が無効 | tokenタイプと権限を確認 |
| 230001 | container_id が無効 | chat_idのフォーマットを確認 |
| 1063001 | 外部メール権限 | ユーザー権限を使用 |

## よくある問題

### tool not found

ツール名のフォーマットを確認：
```bash
✅ mcp__lark-mcp__tool_name
❌ mcp__lark_mcp__tool_name
```

### 99991663 Invalid access token

**原因**: Wiki/ドキュメント検索にはユーザートークンが必要

**解決策**:
1. OAuthを設定（[installation.md](installation.md#oauth-配置) を参照）
2. またはツール呼び出しで `useUAT: true` を使用

### 131005 document is not in wiki

**原因**: `wiki_v2_space_getNode` でドキュメントトークンを使用した

**解決策**: `wikcn` で始まるWikiノードトークンを使用

```
Wikiノードトークン: wikcnxxxxxx  ✅
ドキュメントトークン: doxcnxxxxxx        ❌
```

### 作成したリソースにアクセスできない

**原因**: テナント権限で作成したため、作成者が"飞书助手"になっている

**解決策**:
```yaml
useUAT: true
```

### field not found

**原因**: フィールド名が間違っている、または field_id を使用している

**解決策**: `bitable_v1_appTableField_list` でフィールド名を確認

### invalid request

**よくある原因**:

1. content のフォーマットエラー
```yaml
❌ content: {"text": "hello"}
✅ content: '{"text": "hello"}'
```

2. フィルタの value が配列ではない
```yaml
❌ value: "完了"
✅ value: ["完了"]
```

3. path パラメータが不足
```yaml
path:
  app_token: "bascnxxxxxx"
  table_id: "tblxxxxxx"
```

### グループオーナーがボットになっている

**解決策**: グループ作成時に owner_id を指定
```yaml
data:
  owner_id: "ou_xxxxx"
```

## デバッグのコツ

### 1. MCPサービスの動作確認

```yaml
ツール: mcp__lark-mcp__im_v1_chat_list
params:
  page_size: 1
```

### 2. 最小パラメータでのテスト

まず必須パラメータでテストし、その後オプションパラメータを追加。

### 3. エラー詳細の確認

エラーレスポンスのフォーマット：
```json
{
  "code": 99991663,
  "msg": "具体的なエラーメッセージ"
}
```

## ヘルプ

- [飞书开放平台ドキュメント](https://open.feishu.cn/document/home/index)
- [MCP 統合ドキュメント](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_introduction)
