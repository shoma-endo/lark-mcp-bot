# Repository Guidelines

## WHAT

**Project**: Lark MCP AI Agent Bot using GLM-4.7 with MCP integration

**Structure**:
- `src/` - TypeScript source code. Entry: `src/index.ts`
- `src/bot/` - Bot logic, message processing, tool execution
- `src/glm/` - GLM LLM integration
- `src/storage/` - Conversation storage (Redis/memory)
- `src/utils/` - Utility functions
- `tests/` - Vitest test suites (`bot.test.ts`, `integration.test.ts`)
- `api/` - Serverless entrypoints (webhook routes for Vercel)
- `docs/` - Deployment and operational docs
- `dist/` - Compiled output

---

## HOW

### Build & Test
```bash
npm run dev          # Watch mode (tsx)
npm run build        # Compile to dist/
npm start            # Run from dist/
npm run lint         # ESLint
npm test             # Run all tests
```

### Testing Rules
- Framework: Vitest (`vitest.config.ts`)
- Files: `tests/*.test.ts`
- Single test: `npm test -- tests/integration.test.ts`
- Mock external APIs (Lark/GLM/Redis) for determinism

### Code Style
- 2-space indentation (TS/JSON)
- Explicit types in `src/types.ts` for public interfaces
- lowerCamelCase (vars/funcs), PascalCase (types/classes)
- Domain-focused files (e.g., `src/storage/`)

### Lark MCP Integration
For MCP tool usage, OAuth configuration, and API patterns, see @.agents/skills/lark-mcp/SKILL.md

### Git
- Conventional commits: `feat:`, `fix:`, `chore:`
- PRs: description + linked issue + testing notes
- Behavior changes: include before/after snippets

---

## WHY

This project provides an autonomous Lark bot with:
- MCP tool integration for 100+ Lark API functions
- GLM-4.7 for intelligent responses and tool selection
- Context-aware conversations (Redis in production)
- Type-safe implementation with strict TypeScript
