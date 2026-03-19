# 連絡先

## メールアドレス/電話番号からユーザーIDを取得

```yaml
ツール: mcp__lark-mcp__contact_v3_user_batchGetId
data:
  emails: ["user@example.com"]
  mobiles: ["+8613800138000"]
params:
  user_id_type: "open_id"
```

**注意**: 電話番号は `国番号+番号` の形式、例: `+8613800138000`

## レスポンス

```json
{
  "user_list": [
    {"email": "user@example.com", "open_id": "ou_xxxxx"}
  ],
  "fail_user_list": [
    {"email": "notexist@example.com", "message": "user not found"}
  ]
}
```

## 典型的なシナリオ

```yaml
# 1. 電話番号から open_id を取得
ツール: mcp__lark-mcp__contact_v3_user_batchGetId
data:
  mobiles: ["+8613800138000"]

# 2. open_id で権限を追加
ツール: mcp__lark-mcp__drive_v1_permissionMember_create
data:
  member_type: "openid"
  member_id: "ou_xxxxx"
  perm: "view"
```
