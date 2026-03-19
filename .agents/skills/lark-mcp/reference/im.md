# メッセージ操作

## コアルール

```yaml
# content はJSON文字列である必要がある
❌ content: {"text": "hello"}
✅ content: '{"text": "hello"}'

# receive_id_type は receive_id のタイプと一致している必要がある
receive_id: "oc_xxxxx"
receive_id_type: "chat_id"
```

## メッセージ送信

```yaml
ツール: mcp__lark-mcp__im_v1_message_create
data:
  receive_id: "oc_xxxxx"
  msg_type: "text"
  content: '{"text": "メッセージ内容"}'
params:
  receive_id_type: "chat_id"
```

### メッセージタイプ

| msg_type | content |
|----------|---------|
| text | `{"text": "テキスト"}` |
| post | リッチテキストJSON |
| image | `{"image_key": "xxx"}` |
| file | `{"file_key": "xxx"}` |

### リッチテキスト要素

```yaml
content: '{
  "post": {
    "zh_cn": {
      "title": "タイトル",
      "content": [
        [{"tag": "text", "text": "本文"}],
        [{"tag": "at", "user_id": "ou_xxx", "text": "@田中"}]
      ]
    }
  }
}'
```

| タグ | 例 |
|------|-----|
| テキスト | `{"tag": "text", "text": "内容"}` |
| 太字 | `{"tag": "text", "text": "内容", "style": ["bold"]}` |
| リンク | `{"tag": "a", "text": "文字", "href": "URL"}` |
| @ユーザー | `{"tag": "at", "user_id": "ou_xxx"}` |
| @全員 | `{"tag": "at", "user_id": "all"}` |

## メッセージ履歴の取得

```yaml
ツール: mcp__lark-mcp__im_v1_message_list
params:
  container_id_type: "chat"
  container_id: "oc_xxxxx"
  page_size: 50
```

時間範囲フィルタ：
```yaml
params:
  start_time: "1705276800"  # 秒単位のタイムスタンプ
  end_time: "1705363200"
```

## よくあるエラー

| エラー | 解決策 |
|--------|--------|
| invalid content format | contentをシングルクォートでJSONを囲む |
| receive_id not found | receive_id_typeが一致しているか確認 |
| permission denied | ボットをグループに招待 |
