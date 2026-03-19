# 権限管理

## コアルール

```yaml
# member_type は member_id と一致している必要がある
member_type: "openid"
member_id: "ou_xxxxx"

member_type: "email"
member_id: "user@example.com"
```

## 権限の追加

```yaml
ツール: mcp__lark-mcp__drive_v1_permissionMember_create
path:
  token: "doxcnxxxxxx"
data:
  member_type: "openid"
  member_id: "ou_xxxxx"
  perm: "edit"
params:
  type: "docx"
useUAT: true
```

## member_type

| member_type | member_id |
|-------------|-----------|
| `openid` | `ou_xxxxx` |
| `email` | `user@example.com` |
| `openchat` | `oc_xxxxx` |
| `opendepartmentid` | `od_xxxxx` |

## 権限タイプ

| perm | 説明 |
|------|------|
| `view` | 閲覧のみ |
| `edit` | 編集可能 |
| `full_access` | 完全制御 |

## リソースタイプ

| type | token フォーマット |
|------|-------------------|
| `docx` | `doxcnxxxxxx` |
| `sheet` | スプレッドシートトークン |
| `bitable` | `bascnxxxxxx` |

## よくあるエラー

| エラー | 解決策 |
|--------|--------|
| member not found | member_type と member_id の一致を確認 |
| 1063001 | 外部メール権限にはユーザー権限が必要 |
