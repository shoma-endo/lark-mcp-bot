# Vercel Deploy Error Patterns (lark-mcp-bot)

## 1) `sh: line 1: tsc: command not found`

- Symptom: Build runs `npm run build` and fails before function bundling.
- Root cause: `tsc` unavailable in Vercel install/build context.
- Preferred fix in this repo: avoid TypeScript build in Vercel and rely on API Route bundling.
- File to check: `vercel.json`.

## 2) `No Output Directory named "dist" found after the Build completed`

- Symptom: Vercel build step finishes but fails output validation.
- Root cause: Project expects an output directory in current Vercel project settings.
- Preferred fix in this repo: create `dist` in `buildCommand`.
- File to check: `vercel.json`.

## 3) `The Output Directory "dist" is empty`

- Symptom: `dist` exists but deploy still fails.
- Root cause: Vercel requires at least one file in output directory.
- Preferred fix in this repo: create `dist/index.html` placeholder in `buildCommand`.
- File to check: `vercel.json`.

## 4) Webhook receives message logs but no bot reply

- Symptom: `/webhook/event` log shows incoming message text, no visible response in chat.
- Root cause (known incident): domain mismatch (`Feishu` vs global Lark) caused send failures.
- Preferred fix in this repo:
  - `api/webhook.ts` -> `domain: 'https://open.larksuite.com'`
  - `src/config.ts` -> `const LARK_DOMAIN = 'https://open.larksuite.com'`

## Stable Baseline Snapshot

Keep these lines aligned with current known-good deploy:

```json
{
  "buildCommand": "mkdir -p dist && echo \"ok\" > dist/index.html && echo \"No build step required for Vercel API Routes\"",
  "rewrites": [
    { "source": "/webhook/event", "destination": "/api/webhook" }
  ]
}
```

```ts
// api/webhook.ts
domain: 'https://open.larksuite.com'
```

```ts
// src/config.ts
const LARK_DOMAIN = 'https://open.larksuite.com';
```
