# Wiki（ナレッジベース）

## ⚠️ OAuth設定が必要

Wikiツールにはユーザートークンが必要です。設定しないとエラー 99991663 が返されます。

**設定方法**: [installation.md](installation.md#oauth-配置) を参照

## Wikiノードの検索

```yaml
ツール: mcp__lark-mcp__wiki_v1_node_search
data:
  query: "キーワード"        # パラメータ名は query（search_keyではない）
  page_size: 20
```

レスポンス：
```json
{
  "items": [
    {
      "node_id": "wikcnxxxxxx",
      "obj_token": "doxcnxxxxxx",
      "obj_type": 8,
      "title": "ノードタイトル"
    }
  ]
}
```

## ノード情報の取得

```yaml
ツール: mcp__lark-mcp__wiki_v2_space_getNode
params:
  token: "wikcnxxxxxx"  # Wikiノードトークンである必要がある
```

**注意**: token は `wik` で始まる必要があります。ドキュメントトークン (`doxcn`) は使用できません。

## トークンタイプ

| プレフィックス | タイプ | 用途 |
|--------------|------|------|
| `wikcn` | Wikiノード | `wiki_v2_space_getNode` |
| `doxcn` | ドキュメント | `docx_v1_document_rawContent` |

## URLからトークンを取得

```
Wikiノード: https://xxx.feishu.cn/wiki/wikcnxxxxxx
                                        ↑ Wikiノードトークン

ドキュメント: https://xxx.feishu.cn/docx/doxcnxxxxxx
                                ↑ ドキュメントトークン（wiki_v2_space_getNodeでは使用不可）
```

## よくあるエラー

| エラー | 原因 | 解決策 |
|--------|------|--------|
| 99991663 | ユーザートークンが未設定 | OAuthを設定 |
| 131005 document not in wiki | ドキュメントトークンを使用した | `wikcn` で始まるノードトークンを使用 |

## ドキュメントツールとの連携

```yaml
# 1. Wikiを検索
ツール: mcp__lark-mcp__wiki_v1_node_search
data:
  query: "キーワード"

# 2. obj_token でドキュメント内容を取得
ツール: mcp__lark-mcp__docx_v1_document_rawContent
path:
  document_id: "obj_tokenの値"
useUAT: true
```
