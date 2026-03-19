# グループ管理

## コアルール

```yaml
# owner_id を指定しないとボットがオーナーになる
data:
  owner_id: "ou_xxxxx"
  user_id_list: ["ou_xxxxx"]
```

## グループ作成

```yaml
ツール: mcp__lark-mcp__im_v1_chat_create
data:
  name: "グループ名"
  chat_mode: "group"
  chat_type: "private"       # private/public
  owner_id: "ou_xxxxx"
  user_id_list: ["ou_xxxxx"]
params:
  user_id_type: "open_id"
```

**最小パラメータ**：
```yaml
data:
  chat_mode: "group"
params:
  user_id_type: "open_id"
```

`chat_id` は `oc_` で始まる形式で返されます。

## グループ一覧の取得

```yaml
ツール: mcp__lark-mcp__im_v1_chat_list
params:
  page_size: 50
```

パラメータなしで直接呼び出せます。ボットが所属するすべてのグループが返されます。

## グループメンバーの取得

```yaml
ツール: mcp__lark-mcp__im_v1_chatMembers_get
path:
  chat_id: "oc_xxxxx"
params:
  member_id_type: "open_id"
```

## グループタイプ

| タイプ | 特徴 |
|--------|------|
| private | 招待で参加 |
| public | 検索で参加可能、名称は2文字以上 |

## よくあるエラー

| エラー | 解決策 |
|--------|--------|
| user not found | user_id_type を確認 |
| chat name too short | 公開グループ名は最低2文字 |
