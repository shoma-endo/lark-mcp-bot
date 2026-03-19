# ドキュメント操作

## コアルール

```yaml
# ドキュメント検索にはユーザー権限を使用
useUAT: true

# パラメータ名に注意
docx_builtin_search: search_key  # queryではない
wiki_v1_node_search: query       # search_keyではない
```

## ドキュメント検索

```yaml
ツール: mcp__lark-mcp__docx_builtin_search
data:
  search_key: "キーワード"
  count: 20
useUAT: true
```

レスポンス：
```json
{
  "docs_entities": [
    {
      "docs_token": "doxcnxxxxxx",
      "title": "ドキュメントタイトル",
      "docs_type": "docx"
    }
  ]
}
```

## ドキュメント内容の取得

```yaml
ツール: mcp__lark-mcp__docx_v1_document_rawContent
path:
  document_id: "doxcnxxxxxx"
params:
  lang: 0  # 0=中国語, 1=英語
useUAT: true
```

## Markdownのインポート

```yaml
ツール: mcp__lark-mcp__docx_builtin_import
data:
  markdown: "# タイトル\n\n本文内容..."
  file_name: "ドキュメント.md"
useUAT: true
```

ドキュメントのURLとtokenが返されます。

## docs_typesの選択肢

| タイプ | 説明 |
|------|------|
| `docx` | 新版ドキュメント |
| `doc` | 旧版ドキュメント |
| `sheet` | スプレッドシート |
| `bitable` | Bitable（データベース） |
| `mindnote` | マインドマップ |
| `file` | クラウドファイル |

## URLから document_id を取得

```
https://xxx.feishu.cn/docx/doxcnxxxxxx
                          ↑ document_id
```

## よくあるエラー

| エラー | 解決策 |
|--------|--------|
| User access token not configured | OAuthを設定 |
| permission denied | `useUAT: true` を使用 |
| document not found | document_idを確認 |

## ワークフロー：インポートして共有

```yaml
# 1. Markdownをインポート
ツール: mcp__lark-mcp__docx_builtin_import
data:
  markdown: "# レポート\n\n内容..."

# 2. 権限を追加（返されたtokenを使用）
ツール: mcp__lark-mcp__drive_v1_permissionMember_create
path:
  token: "返されたtoken"
params:
  type: "docx"
data:
  member_type: "email"
  member_id: "user@example.com"
  perm: "view"
```
