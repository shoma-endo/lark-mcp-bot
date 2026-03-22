# lark-mcp-bot - Claude Code Context

See @README.md for project overview, architecture, and deployment details.

---

## WHAT

**Project**: Lark MCP AI Agent Bot using GLM-4.7 with MCP integration

**Tech Stack**:
- TypeScript (strict mode)
- Lark API SDK (`@larksuiteoapi/node-sdk`)
- MCP tools (`@larksuiteoapi/lark-mcp`)
- GLM-4.7 LLM via OpenAI-compatible API
- Vitest for testing
- Upstash Redis for production storage

**Structure**:
- `src/bot/` - Bot logic, message processing, tool execution
- `src/storage/` - Conversation storage (Redis/memory)
- `src/config.ts` - Configuration management
- `src/types.ts` - Type definitions
- `tests/` - Vitest test suites
- `api/webhook.ts` - Vercel serverless entrypoint

---

## HOW

### Verification
```bash
npm run typecheck      # TypeScript strict mode check
npm test               # Run all tests
npm run test:coverage  # Target: 80%+ coverage
```

### Development
```bash
npm run dev           # Watch mode with tsx
npm run build         # Compile to dist/
npm start             # Run from dist/
```

### Environment
This project uses npm. Required env vars:
- `LARK_APP_ID`, `LARK_APP_SECRET`
- `GLM_API_KEY`, `GLM_API_BASE_URL`, `GLM_MODEL`
- `KV_REST_API_URL`, `KV_REST_API_READ_ONLY_TOKEN` (optional - production only)

See @README.md for full setup instructions.

### Lark MCP Integration
For detailed MCP tool usage, OAuth setup, and API patterns, see @.agents/skills/lark-mcp/SKILL.md

### Development Philosophy
**Security**: This is a personal-use project. General web app security concerns are not a priority. Focus on code simplicity and maintainability.

**Implementation Priorities**:
1. Reuse existing implementations and patterns
2. Write concise, straightforward code
3. Avoid over-engineering
4. Prioritize readability and simplicity over comprehensive security measures
