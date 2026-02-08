---
name: lark-vercel-deploy
description: Diagnose and fix Vercel deployment failures for this lark-mcp-bot repository, including TypeScript build-tool issues, Vercel output directory errors, and Lark/Feishu domain mismatches. Use when deployment logs include build failures, missing dist/output errors, webhook endpoint issues, or when preparing a safe production redeploy.
---

# Lark Vercel Deploy

Follow this workflow in order to keep deploy fixes minimal and repeatable.

## Step 1: Classify the Failure From Logs

Match the log to a known pattern in `references/vercel-deploy-errors.md`.

- `tsc: command not found`
- `No Output Directory named "dist" found`
- `The Output Directory "dist" is empty`
- Webhook receives messages but bot does not reply

If no pattern matches, inspect `vercel.json`, `api/webhook.ts`, and `src/config.ts` first.

## Step 2: Apply Repository-Specific Baseline

Keep these defaults unless the user explicitly requests a different architecture:

- `vercel.json` keeps API Routes deployment flow.
- `vercel.json` keeps a non-TS build command that creates non-empty `dist`.
- `api/webhook.ts` uses `https://open.larksuite.com` for Lark domain.
- `src/config.ts` keeps `LARK_DOMAIN` constant fixed to `https://open.larksuite.com`.
- `/webhook/event` rewrite points to `/api/webhook`.

## Step 3: Patch Only What Is Needed

Prefer the smallest change that resolves the observed failure:

1. Edit only one or a few files.
2. Avoid refactors during incident response.
3. Preserve unrelated user changes in dirty working trees.

## Step 4: Verify Before Commit

Run checks after each fix:

```bash
npm run build
npx vitest run tests/config.test.ts
```

If deployment errors are Vercel-only, still validate local TypeScript/tests when possible.

## Step 5: Commit and Redeploy

Commit only incident-related files with a `fix:` message.

After push, ask the user to redeploy and confirm:

1. Build completes.
2. `/webhook/event` returns `200`.
3. Bot replies in Lark group chat.

## Response Contract

When using this skill, always report:

1. Root cause in one sentence.
2. Exact files changed.
3. Validation commands and pass/fail.
4. Next operator action (usually redeploy/retest).
