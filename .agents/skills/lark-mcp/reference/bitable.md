# Bitable（データベース）

## コアルール

```yaml
# リソース作成にはユーザー権限を使用
useUAT: true

# フィルタ条件の value は配列形式である必要がある
✅ value: ["完了"]
❌ value: "完了"

# フィールド名として field_name を使用（field_idではない）
field_name: "ステータス"
```

## URL 解析

```
https://xxx.feishu.cn/base/bascnxxxxxx?table=tblxxxxxx
                         ↑app_token         ↑table_id
```

## ワークフロー

### 1. Base作成

```yaml
ツール: mcp__lark-mcp__bitable_v1_app_create
data:
  name: "Base名称"
useUAT: true
```

`app_token` と `default_table_id` が返されます。

### 2. データテーブル作成

```yaml
ツール: mcp__lark-mcp__bitable_v1_appTable_create
path:
  app_token: "bascnxxxxxx"
data:
  table:
    name: "テーブル名"
    fields:
      - field_name: "テキスト"
        ui_type: "Text"
      - field_name: "単一選択"
        ui_type: "SingleSelect"
        property:
          options:
            - name: "オプション1"
      - field_name: "日時"
        ui_type: "DateTime"
useUAT: true
```

### 3. レコード検索

```yaml
ツール: mcp__lark-mcp__bitable_v1_appTableRecord_search
path:
  app_token: "bascnxxxxxx"
  table_id: "tblxxxxxx"
data:
  filter:
    conjunction: "and"
    conditions:
      - field_name: "ステータス"
        operator: "is"
        value: ["完了"]
```

### 4. レコード作成

```yaml
ツール: mcp__lark-mcp__bitable_v1_appTableRecord_create
path:
  app_token: "bascnxxxxxx"
  table_id: "tblxxxxxx"
data:
  fields:
    テキストフィールド: "値"
    単一選択フィールド: "オプション名"
    日付フィールド: 1705276800000
useUAT: true
```

### 5. レコード更新

```yaml
ツール: mcp__lark-mcp__bitable_v1_appTableRecord_update
path:
  app_token: "bascnxxxxxx"
  table_id: "tblxxxxxx"
  record_id: "recxxxxxx"
data:
  fields:
    ステータス: "完了"
useUAT: true
```

## フィールドタイプ

| ui_type | 説明 | 例 |
|---------|------|-----|
| Text | テキスト | `"内容"` |
| Number | 数値 | `123` |
| SingleSelect | 単一選択 | `"オプション名"` |
| MultiSelect | 複数選択 | `["オプション1", "オプション2"]` |
| DateTime | 日時 | `1705276800000` (ミリ秒) |
| User | ユーザー | `"ou_xxxxx"` |
| Checkbox | チェックボックス | `true`/`false` |

## 演算子

| operator | 説明 |
|----------|------|
| `is` | 等しい |
| `isNot` | 等しくない |
| `contains` | 含む |
| `isEmpty` | 空である |
| `isGreater` | より大きい |
| `isLess` | より小さい |

## 補助ツール

```yaml
# データテーブル一覧を取得
ツール: mcp__lark-mcp__bitable_v1_appTable_list
path:
  app_token: "bascnxxxxxx"

# フィールド一覧を取得
ツール: mcp__lark-mcp__bitable_v1_appTableField_list
path:
  app_token: "bascnxxxxxx"
  table_id: "tblxxxxxx"
```

## よくあるエラー

| エラー | 解決策 |
|--------|--------|
| field not found | `appTableField_list` でフィールド名を確認 |
| invalid filter | value は配列形式 `["値"]` を使用 |
| 作成後にアクセスできない | `useUAT: true` を使用 |
