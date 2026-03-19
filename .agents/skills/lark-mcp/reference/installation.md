# インストールと設定

## クイック設定

```json
{
  "mcpServers": {
    "lark-mcp": {
      "command": "npx",
      "args": ["-y", "@larksuiteoapi/lark-mcp", "mcp", "-a", "<app_id>", "-s", "<app_secret>"]
    }
  }
}
```

**注意**: `-t` でツールを制限しないでください。指定したツールのみが読み込まれます。

## パラメータ

| パラメータ | 必須 | 説明 |
|-----------|:----:|------|
| `-a` | ✅ | App ID |
| `-s` | ✅ | App Secret |
| `--oauth` | ❌ | ユーザー認証を有効化 |
| `--token-mode` | ❌ | `user_access_token` |
| `--domain` | ❌ | 国際版は `https://open.larksuite.com` |

## OAuth設定

以下のツールにはユーザートークンが必要です：
- `docx_builtin_search`（ドキュメント検索）
- `wiki_v1_node_search`（Wiki検索）

### ⚠️ よくある落とし穴

**`--oauth` を追加するだけでは不十分で、同時に `--token-mode user_access_token` も追加する必要があります**：

```json
// ❌ 間違い：--oauthのみ追加すると、99991663エラーが返される
{"args": ["-y", "@larksuiteoapi/lark-mcp", "mcp", "-a", "cli_xxx", "-s", "xxx", "--oauth"]}

// ✅ 正しい：両方を追加する必要がある
{"args": ["-y", "@larksuiteoapi/lark-mcp", "mcp", "-a", "cli_xxx", "-s", "xxx", "--oauth", "--token-mode", "user_access_token"]}
```

**設定後はエージェントツールを再起動する必要があります**

### 設定手順

**1. ターミナルでログイン**
```bash
npx -y @larksuiteoapi/lark-mcp login -a cli_xxx -s xxx
```

**2. 設定を更新**
```json
{
  "mcpServers": {
    "lark-mcp": {
      "args": [
        "-y", "@larksuiteoapi/lark-mcp", "mcp",
        "-a", "cli_xxx", "-s", "xxx",
        "--oauth",
        "--token-mode", "user_access_token"
      ]
    }
  }
}
```

**3. リダイレクトURLを設定**

飞书开放平台 → アプリ → セキュリティ設定 → 追加：
```
http://localhost:3000/callback
```

**4. Claude Codeを再起動**

## OAuthの効果

| シナリオ | OAuthなし | OAuthあり |
|----------|----------|-----------|
| リソース作成 | 作成者=飞书助手 | 作成者=現在のユーザー |
| ドキュメント/Wiki検索 | ❌ | ✅ |
| プライベートリソースへのアクセス | ❌ | ✅ |

## よくある問題

| 問題 | 原因 | 解決策 |
|------|------|--------|
| ツールが3つしかない | `-t` を使用している | `-t` パラメータを削除 |
| 99991663エラー | OAuthが不完全 | `--oauth` と `--token-mode user_access_token` を両方追加 |
| redirect_uri_mismatch | リダイレクト未設定 | `http://localhost:3000/callback` を追加 |

## プリセットツールセット

| プリセット | 用途 |
|-----------|------|
| `preset.default` | デフォルト、一般的な機能 |
| `preset.im.default` | インスタントメッセージ |
| `preset.base.default` | Bitable（データベース） |
| `preset.doc.default` | ドキュメント操作 |

## 認証情報の取得

1. [飞书开放平台](https://open.feishu.cn/app) にアクセス
2. 企業自建アプリを作成
3. App ID と App Secret を取得
4. 必要な権限を追加

## 関連リンク

- [飞书开放平台](https://open.feishu.cn/)
- [MCP 統合ドキュメント](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_installation)
