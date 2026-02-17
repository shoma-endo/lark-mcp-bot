# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the TypeScript source code. Entry point is `src/index.ts`, with feature modules under `src/bot/`, `src/glm/`, `src/storage/`, and `src/utils/`.
- `tests/` contains Vitest suites such as `bot.test.ts` and `integration.test.ts`.
- `api/` holds serverless entrypoints (e.g., webhook routes for deployment).
- `docs/` contains deployment and operational documentation.
- `dist/` is the compiled output from TypeScript builds.

## Build, Test, and Development Commands
- `npm run dev`: run the bot in watch mode via `tsx` for local development.
- `npm run build`: compile TypeScript to `dist/` using `tsc`.
- `npm start`: run the compiled server from `dist/index.js`.
- `npm run lint`: lint `src/` with ESLint.
- `npm test`: run all tests with Vitest.

## Coding Style & Naming Conventions
- Use 2-space indentation in TypeScript and JSON files.
- Prefer explicit types for public functions and exported interfaces in `src/types.ts`.
- Naming patterns follow lower camelCase for variables/functions and PascalCase for types/classes.
- Keep files focused by domain (e.g., storage code in `src/storage/`).

## Testing Guidelines
- Framework: Vitest (`vitest.config.ts`).
- Test files live in `tests/` and are named `*.test.ts`.
- For an integration run, target a single file: `npm test -- tests/integration.test.ts`.
- Keep tests deterministic by mocking external API calls (Lark/GLM/Redis) where possible.

## Commit & Pull Request Guidelines
- Use conventional prefixes in commit subjects (e.g., `feat:`, `fix:`, `chore:`). Recent history mixes English and Japanese descriptions; keep the prefix consistent.
- PRs should include a short description, linked issue (if any), and testing notes (e.g., `npm test`).
- If behavior changes user-facing responses, include before/after snippets or screenshots in the PR.

## Security & Configuration Tips
- Configure secrets via `.env` and never commit credentials. Key variables include `LARK_APP_ID`, `LARK_APP_SECRET`, `GLM_API_KEY`, and optional `UPSTASH_REDIS_*`.
- For production, review `docs/VERCEL-DEPLOYMENT.md` and ensure the webhook path matches `WEBHOOK_PATH`.
