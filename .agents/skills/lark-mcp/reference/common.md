# 共通概念

## パラメータ構造

```yaml
path: {app_token, table_id, chat_id}  # URLパスパラメータ
params: {page_size, user_id_type}     # クエリパラメータ
data: {fields, content, ...}          # リクエストボディ
useUAT: false                         # true=ユーザー権限, false=テナント権限
```

## useUAT の選択基準

| シナリオ | useUAT | 説明 |
|----------|:------:|------|
| リソース作成 | `true` | 作成者=現在のユーザー |
| ユーザーのプライベートデータへのアクセス | `true` | ユーザー権限が必要 |
| パブリックデータのクエリ | `false` | デフォルト、テナント権限 |

## IDタイプ

| プレフィックス | タイプ | 取得元 |
|--------------|--------|--------|
| `ou_` | ユーザーID | APIレスポンス |
| `oc_` | グループチャットID | `im_v1_chat_list` またはURL |
| `bascn` | Bitable（データベース） | URLの `base/` の後ろ |
| `tbl` | データテーブル | URLパラメータ `table=` |
| `rec` | レコードID | APIレスポンス |
| `doxcn` | ドキュメント | 検索結果またはURL |
| `wikcn` | Wikiノード | WikiのURL |

## ページネーション

```yaml
params:
  page_size: 50
  page_token: ""  # 最初は空、以降は返り値を使用
```

レスポンスには `has_more` と `page_token` が含まれます。

## エラーコード

| エラーコード | 解決策 |
|--------------|--------|
| 99991663 | `useUAT: true` またはOAuthを設定 |
| 131005 | tokenタイプと権限を確認 |
| 230001 | chat_idのフォーマットを確認 |
| 1063001 | 外部メール権限にはユーザー権限が必要 |
