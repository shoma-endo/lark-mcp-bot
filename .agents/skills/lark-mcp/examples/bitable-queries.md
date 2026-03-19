# Bitable クエリ例

## よく使うクエリ

### 完全一致
```yaml
data:
  filter:
    conjunction: "and"
    conditions:
      - field_name: "ステータス"
        operator: "is"
        value: ["完了"]
```

### テキスト部分一致
```yaml
data:
  filter:
    conditions:
      - field_name: "タスク名"
        operator: "contains"
        value: ["キーワード"]
```

### 数値/日付範囲
```yaml
data:
  filter:
    conditions:
      - field_name: "優先度"
        operator: "isGreater"
        value: ["3"]
```

### 空値チェック
```yaml
data:
  filter:
    conditions:
      - field_name: "担当者"
        operator: "isEmpty"
        value: []
```

### 複数条件
```yaml
data:
  filter:
    conjunction: "and"  # または "or"
    conditions:
      - field_name: "ステータス"
        operator: "is"
        value: ["未処理"]
      - field_name: "優先度"
        operator: "isGreater"
        value: ["3"]
```

## 演算子

| operator | 対応タイプ |
|----------|------------|
| is | すべてのタイプ |
| isNot | 日付タイプを除くすべて |
| contains | テキスト |
| isEmpty | すべてのタイプ |
| isGreater | 数値、日付 |
| isLess | 数値、日付 |
