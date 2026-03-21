# Bitable汎用テンプレート ガイド

## 概要

`bitable-universal-template.json` は、Lark（飞書）のBitable（データベース）Baseを作成・構成するための汎用的なテンプレートです。

## 特徴

- **完全な汎用化**: すべての固定値をプレースホルダーとして提供
- **豊富なフィールドタイプ**: テキスト、数値、選択肢、日付、担当者など20種類以上
- **カスタマイズ例**: プロジェクト管理、顧客管理、タスク追跡の実例を収録
- **詳細なリファレンス**: フィールドタイプ、カラーコードの完全な説明
- **MCP対応**: Lark MCPツールの正しい呼び出し形式に対応

## 基本的な使い方

### ステップ1: テンプレートをカスタマイズ

1. `bitable-universal-template.json` をコピーしてカスタマイズ用のファイルを作成
2. すべての `{{PLACEHOLDER}}` を実際の値に置き換える

### ステップ2: Baseを作成

```bash
# Lark MCPツールを使用してBaseを作成
mcp__lark-mcp__bitable_v1_app_create
```

レスポンスから `app.app_token` を取得し、`{{APP_TOKEN}}` として保存

### ステップ3: テーブルを作成

```bash
# 各テーブルを作成
mcp__lark-mcp__bitable_v1_appTable_create
```

レスポンスから各 `table_id` を取得し、対応する `{{TABLE_ID_N}}` として保存

### ステップ4: フィールドを作成

```bash
# 各テーブルにフィールドを作成
mcp__lark-mcp__bitable_v1_appTableField_create
```

### ステップ5: レコードを投入

```bash
# 各テーブルにレコードを投入
mcp__lark-mcp__bitable_v1_appTableRecord_create
```

## プレースホルダー一覧

### 基本プレースホルダー

| プレースホルダー | 説明 | 例 |
|---|---|---|
| `{{BASE_NAME}}` | Baseの名前 | "プロジェクト管理Base" |
| `{{FOLDER_NAME}}` | 親フォルダ名（省略可能） | "プロジェクト" |

### テーブル関連

| プレースホルダー | 説明 | 例 |
|---|---|---|
| `{{TABLE_NAME_N}}` | N番目のテーブル名 | "案件管理" |
| `{{TABLE_ID_N}}` | N番目のテーブルID（APIレスポンスから取得） | "tblxxxxxxx" |
| `{{DEFAULT_VIEW_NAME_N}}` | N番目のテーブルのデフォルトビュー名 | "すべての案件" |

### フィールド関連

| プレースホルダー | 説明 | 例 |
|---|---|---|
| `{{FIELD_NAME_N}}` | N番目のフィールド名 | "案件名" |
| `{{FIELD_DESCRIPTION_N}}` | N番目のフィールドの説明 | "プロジェクトの案件名" |
| `{{SELECT_FIELD_NAME}}` | 単一選択フィールド名 | "ステータス" |
| `{{MULTI_SELECT_FIELD_NAME}}` | 複数選択フィールド名 | "スキル" |
| `{{OPTION_N}}` | 選択肢の値 | "進行中" |
| `{{COLOR_CODE}}` | 選択肢の色コード（0-10） | 2 |

### レコード関連

| プレースホルダー | 説明 | 例 |
|---|---|---|
| `{{SAMPLE_VALUE_N}}` | サンプルレコードの値 | "プロジェクトA" |
| `{{RELATED_VALUE_N}}` | 関連フィールドの値 | "顧客ID" |

## フィールドタイプ一覧

| タイプコード | タイプ名 | 説明 | サンプルデータ |
|---|---|---|---|
| 1 | text | テキスト | "サンプルテキスト" |
| 2 | number | 数値 | 100 |
| 3 | single_select | 単一選択 | "進行中" |
| 4 | multi_select | 複数選択 | ["Java", "Python"] |
| 5 | date | 日付 | 1735689600000 |
| 11 | person | 担当者 | "ou_xxxxx" |
| 13 | attachment | 添付ファイル | {"file_token": "..."} |
| 15 | url | リンク | "https://example.com" |
| 17 | email | メールアドレス | "example@example.com" |
| 18 | phone | 電話番号 | "+81-90-1234-5678" |
| 19 | datetime | 日時 | 1735689600000 |
| 20 | progress | 進捗率 | 75 |
| 21 | currency | 通貨 | 1000000 |
| 22 | checkbox | チェックボックス | true |
| 23 | formula | 数式 | （自動計算） |
| 24 | relation | 関連 | （別テーブルへの関連） |
| 25 | lookup | 参照 | （関連フィールドからの参照） |
| 26 | member | メンバー | ["ou_xxxxx", "ou_yyyyy"] |
| 27 | group | グループ | "oc_xxxxx" |
| 1001 | created_time | 作成日時 | （自動） |
| 1002 | modified_time | 更新日時 | （自動） |
| 1003 | created_user | 作成者 | （自動） |
| 1004 | modified_user | 更新者 | （自動） |

## カラーコード一覧

選択肢（single_select、multi_select）で使用できる色コード

| コード | 色 |
|---|---|
| 0 | デフォルト |
| 1 | シアン |
| 2 | グリーン |
| 3 | ライム |
| 4 | イエロー |
| 5 | オレンジ |
| 6 | レッド |
| 7 | マゼンタ |
| 8 | バイオレット |
| 9 | ブルー |
| 10 | ターコイズ |

## 日付フォーマット

日付フィールドには Unix タイムスタンプ（ミリ秒）を使用します。

### 変換方法

**オンライン変換ツール**: https://www.unixtimestamp.com/

**Pythonでの変換例**:

```python
import datetime
import time

# 日付 → Unixタイムスタンプ（ミリ秒）
dt = datetime.datetime(2025, 1, 1, 0, 0, 0)
timestamp_ms = int(dt.timestamp() * 1000)
print(timestamp_ms)  # 1735689600000

# Unixタイムスタンプ（ミリ秒）→ 日付
timestamp_ms = 1735689600000
dt = datetime.datetime.fromtimestamp(timestamp_ms / 1000)
print(dt)  # 2025-01-01 00:00:00
```

## カスタマイズ例

### 例1: プロジェクト管理Base

```json
{
  "step_1_create_base": {
    "data": {
      "name": "プロジェクト管理Base"
    }
  },
  "step_2_create_tables": [
    {
      "data": {
        "table": {
          "name": "案件管理"
        }
      }
    }
  ],
  "step_3_create_fields": {
    "案件管理": {
      "fields": [
        {
          "field_name": "案件名",
          "type": 1
        },
        {
          "field_name": "ステータス",
          "type": 3,
          "property": {
            "options": [
              {"name": "提案中", "color": 1},
              {"name": "受注確定", "color": 2},
              {"name": "完了", "color": 9},
              {"name": "失注", "color": 6}
            ]
          }
        },
        {
          "field_name": "見積金額（万円）",
          "type": 21
        },
        {
          "field_name": "担当者",
          "type": 11
        },
        {
          "field_name": "納期",
          "type": 5
        }
      ]
    }
  }
}
```

### 例2: 顧客管理Base

```json
{
  "step_1_create_base": {
    "data": {
      "name": "顧客管理Base"
    }
  },
  "step_2_create_tables": [
    {
      "data": {
        "table": {
          "name": "顧客情報"
        }
      }
    }
  ],
  "step_3_create_fields": {
    "顧客情報": {
      "fields": [
        {
          "field_name": "会社名",
          "type": 1
        },
        {
          "field_name": "業種",
          "type": 3,
          "property": {
            "options": [
              {"name": "IT", "color": 2},
              {"name": "製造", "color": 7},
              {"name": "金融", "color": 3},
              {"name": "小売", "color": 1}
            ]
          }
        },
        {
          "field_name": "メールアドレス",
          "type": 17
        },
        {
          "field_name": "電話番号",
          "type": 18
        },
        {
          "field_name": "Webサイト",
          "type": 15
        }
      ]
    }
  }
}
```

### 例3: タスク追跡Base

```json
{
  "step_1_create_base": {
    "data": {
      "name": "タスク追跡Base"
    }
  },
  "step_2_create_tables": [
    {
      "data": {
        "table": {
          "name": "タスク"
        }
      }
    }
  ],
  "step_3_create_fields": {
    "タスク": {
      "fields": [
        {
          "field_name": "タスク名",
          "type": 1
        },
        {
          "field_name": "説明",
          "type": 1
        },
        {
          "field_name": "担当者",
          "type": 11
        },
        {
          "field_name": "優先度",
          "type": 3,
          "property": {
            "options": [
              {"name": "低", "color": 0},
              {"name": "中", "color": 7},
              {"name": "高", "color": 8},
              {"name": "緊急", "color": 6}
            ]
          }
        },
        {
          "field_name": "ステータス",
          "type": 3,
          "property": {
            "options": [
              {"name": "未着手", "color": 0},
              {"name": "進行中", "color": 2},
              {"name": "レビュー中", "color": 7},
              {"name": "完了", "color": 9}
            ]
          }
        },
        {
          "field_name": "期限",
          "type": 5
        },
        {
          "field_name": "進捗率",
          "type": 20
        }
      ]
    }
  }
}
```

## Lark MCPツールの使用方法

### MCPツールの呼び出し形式

```yaml
ツール: mcp__lark-mcp__bitable_v1_app_create
data:
  name: "Base名"
  folder: "フォルダ名（省略可）"

ツール: mcp__lark-mcp__bitable_v1_appTable_create
path:
  app_token: "bascnxxxxxx"
data:
  table:
    name: "テーブル名"

ツール: mcp__lark-mcp__bitable_v1_appTableField_create
path:
  app_token: "bascnxxxxxx"
  table_id: "tblxxxxxx"
data:
  field_name: "フィールド名"
  type: 1  # フィールドタイプコード
  description: "説明（省略可）"
  property:
    # 単一選択・複数選択の場合
    options:
      - name: "オプション名"
        color: 1

ツール: mcp__lark-mcp__bitable_v1_appTableRecord_create
path:
  app_token: "bascnxxxxxx"
  table_id: "tblxxxxxx"
data:
  fields:
    フィールド名: 値
    複数選択フィールド名: ["オプション1", "オプション2"]
useUAT: true  # ユーザー権限で実行
```

### 重要なポイント

1. **contentはJSON文字列である必要がある**
   ```yaml
   ❌ content: {"text": "hello"}
   ✅ content: '{"text": "hello"}'
   ```

2. **フィルタ条件のvalueは配列である必要がある**
   ```yaml
   ❌ value: "完了"
   ✅ value: ["完了"]
   ```

3. **useUATの選択**
   - ユーザーがアクセスできるリソースを作成する場合: `true`
   - パブリックデータのクエリ: `false`

## よくある質問

### Q: テーブルを追加・削除するにはどうすればいいですか？

A: `step_2_create_tables` 配列にテーブル定義を追加または削除してください。対応する `step_3_create_fields` と `step_4_create_records` も更新してください。

### Q: 既存のBaseにテーブルを追加できますか？

A: はい、既存のBaseの `app_token` を使用して、`step_2_create_tables` 以降のステップのみを実行できます。

### Q: 関連フィールド（relation）を使用するにはどうすればいいですか？

A: `type: 24` を使用し、`property` に `foreign_table_id` と `lookup_field_id` を指定します。詳細はテンプレートの `{{RELATION_FIELD_NAME}}` の例を参照してください。

### Q: レコードの値を動的に生成できますか？

A: はい、テンプレートをプログラム（Python、JavaScriptなど）で読み込み、プレースホルダーを動的に置換してからMCPツールに渡すことができます。

## トラブルシューティング

### エラー: field not found

**原因**: フィールド名が間違っている

**対処法**: `bitable_v1_appTableField_list` で正しいフィールド名を確認してください

### エラー: 99991663

**原因**: 権限不足

**対処法**: `useUAT: true` を使用するか、OAuthを設定してください

### エラー: invalid content

**原因**: フォーマットエラー

**対処法**: contentをJSONとしてシングルクォートで囲んでください

## 関連ドキュメント

- [bitable-project-management-sample.json](./bitable-project-management-sample.json) - プロジェクト管理の完全なサンプル
- [ORCHESTRATOR-SPEC.md](./ORCHESTRATOR-SPEC.md) - オーケストレータ仕様（関連があれば）
- [Lark MCP SKILL.md](../.agents/skills/lark-mcp/SKILL.md) - Lark MCPツールの詳細ガイド

## ライセンス

このテンプレートはLark MCPボットプロジェクトの一部として提供されています。
