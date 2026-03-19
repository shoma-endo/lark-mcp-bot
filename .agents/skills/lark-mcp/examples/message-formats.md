# メッセージフォーマット例

## テキスト
```json
{"text": "メッセージ内容"}
```

## リッチテキスト

### 基本
```json
{
  "post": {
    "zh_cn": {
      "title": "タイトル",
      "content": [[{"tag": "text", "text": "内容"}]]
    }
  }
}
```

### スタイル
```json
[
  {"tag": "text", "text": "通常"},
  {"tag": "text", "text": "太字", "style": ["bold"]},
  {"tag": "a", "text": "リンク", "href": "https://example.com"},
  {"tag": "at", "user_id": "ou_xxxxx"}
]
```

## 要素

| tag | 例 |
|-----|-----|
| text | `{"tag": "text", "text": "内容"}` |
| a | `{"tag": "a", "text": "リンク", "href": "URL"}` |
| at | `{"tag": "at", "user_id": "ou_xxx"}` |

## スタイル

- `bold` - 太字
- `italic` - 斜体
- `strikethrough` - 打ち消し線
