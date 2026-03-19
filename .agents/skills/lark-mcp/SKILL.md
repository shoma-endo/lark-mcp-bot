---
name: lark-mcp
description: 飞書/Lark公式MCP統合。メッセージ送信、グループ作成、Bitable（データベース）操作、ドキュメントインポート/検索、Wiki（ナレッジベース）検索をサポート。トリガーワード：飛書、Feishu、Lark、Bitable、bitable、飛書ドキュメント、飛書グループ。
---

# Lark MCP

## ⚠️ 重要な注意点

**ドキュメント検索とWiki検索にはOAuth設定が必要**：
- `docx_builtin_search` → `--oauth` が必要
- `wiki_v1_node_search` → `--oauth` が必要

設定しないとエラー 99991663 が返されます。設定方法は [installation.md](reference/installation.md#oauth-配置) を参照

---

## コアルール

```yaml
# ツール命名（ハイフン、アンダースコアではない）
✅ mcp__lark-mcp__tool_name
❌ mcp__lark_mcp__tool_name

# パラメータ構造
path: {app_token, table_id}   # URLパスパラメータ
params: {page_size, ...}      # クエリパラメータ
data: {fields, ...}           # リクエストボディ
useUAT: false                 # true=ユーザー権限, false=テナント権限
```

## よくある落とし穴

```yaml
# contentはJSON文字列である必要がある
❌ content: {"text": "hello"}
✅ content: '{"text": "hello"}'

# フィルタ条件のvalueは配列である必要がある
❌ value: "完了"
✅ value: ["完了"]

# グループ作成時はowner_idを指定しないとボットがオーナーになる
owner_id: "ou_xxxxx"

# パラメータ名の違いに注意
docx_builtin_search: search_key  # queryではない
wiki_v1_node_search: query       # search_keyではない

# トークンタイプの違い
wiki_v2_space_getNode: wikcn...  # doxcn...は使えない
docx_v1_document_rawContent: doxcn...
```

## useUATの選択基準

| シナリオ | useUAT |
|----------|:------:|
| リソース作成（ユーザーがアクセスできるようにする場合） | `true` |
| ドキュメント検索・Wiki検索 | `true` |
| ユーザーのプライベートデータへのアクセス | `true` |
| パブリックデータのクエリ | `false` |

## ツールクイックリファレンス

| カテゴリ | ツール | ドキュメント |
|----------|------|------|
| メッセージ | `im_v1_message_create`, `im_v1_message_list` | [im.md](reference/im.md) |
| グループ | `im_v1_chat_create`, `im_v1_chat_list`, `im_v1_chatMembers_get` | [chat.md](reference/chat.md) |
| Bitable（データベース） | `bitable_v1_app_create`, `bitable_v1_appTableRecord_search/create/update` | [bitable.md](reference/bitable.md) |
| ドキュメント | `docx_builtin_search`, `docx_v1_document_rawContent`, `docx_builtin_import` | [documents.md](reference/documents.md) |
| Wiki（ナレッジベース） | `wiki_v1_node_search`, `wiki_v2_space_getNode` | [wiki.md](reference/wiki.md) |

## IDタイプ

| プレフィックス | タイプ | 取得元 |
|--------------|--------|--------|
| `ou_` | ユーザーID | APIレスポンスから取得 |
| `oc_` | グループID | `im_v1_chat_list` から取得 |
| `bascn` | Bitable（データベース） | URLの `base/` の後ろ |
| `tbl` | テーブル | URLパラメータ `table=` |
| `doxcn` | ドキュメント | 検索結果またはURL |
| `wikcn` | Wikiノード（ナレッジベース） | WikiのURL |

## クイック例

```yaml
# テキストメッセージを送信
ツール: mcp__lark-mcp__im_v1_message_create
data:
  receive_id: "oc_xxxxx"  # グループID
  msg_type: "text"
  content: '{"text": "こんにちは！これはテストメッセージです。"}'
params:
  receive_id_type: "chat_id"

# 新しいグループを作成
ツール: mcp__lark-mcp__im_v1_chat_create
data:
  name: "プロジェクトチーム"
  chat_mode: "group"  # グループチャット
  owner_id: "ou_xxxxx"  # グループ管理者のユーザーID
  user_id_list: ["ou_xxxxx"]  # グループメンバーのユーザーIDリスト
params:
  user_id_type: "open_id"  # ユーザーIDのタイプ

# Bitableにレコードを作成
ツール: mcp__lark-mcp__bitable_v1_appTableRecord_create
path:
  app_token: "bascnxxxxxx"  # Bitableのトークン
  table_id: "tblxxxxxx"    # テーブルID
data:
  fields:
    タスク名: "要件定義"
    ステータス: "進行中"
    優先度: "高"
useUAT: true  # ユーザー権限で実行

# ドキュメントをキーワード検索
ツール: mcp__lark-mcp__docx_builtin_search
data:
  search_key: "プロジェクト計画"  # 検索キーワード
  count: 10  # 取得件数
useUAT: true  # OAuthが必要
```

## エラー対処表

| エラー | 原因 | 対処法 |
|--------|------|--------|
| tool not found | サーバー名が間違っている | `mcp__lark-mcp__` プレフィックスを使用 |
| 99991663 | 権限不足 | `useUAT: true` またはOAuthを設定 |
| 131005 not found | IDタイプが間違っている（wikcnとdoxcnの使い分け） | `wikcn` はWikiノード、`doxcn` はドキュメントで使用 |
| 作成したリソースにアクセスできない | テナント権限で作成した | `useUAT: true` を使用 |
| field not found | フィールド名が間違っている | `appTableField_list` で確認 |
| invalid content | フォーマットエラー | contentをJSONとしてシングルクォートで囲む |

**詳細ドキュメント**: [troubleshooting.md](reference/troubleshooting.md) | [installation.md](reference/installation.md)
