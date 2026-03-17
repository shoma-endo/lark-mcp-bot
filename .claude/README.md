# .claude/ - Claude Code プロジェクト設定

このディレクトリには、Autonomous Operations プロジェクトで Claude Code による開発を最適化するための設定ファイルとツールが含まれています。

## 📁 ディレクトリ構造

```
.claude/
├── README.md                    # このファイル
├── settings.example.json        # 設定テンプレート
├── settings.local.json          # ローカル設定（Git管理外）
│
├── agents/                      # Agent定義
│   ├── coordinator-agent.md     # CoordinatorAgent
│   ├── codegen-agent.md         # CodeGenAgent
│   ├── review-agent.md          # ReviewAgent
│   ├── issue-agent.md           # IssueAgent
│   ├── pr-agent.md              # PRAgent
│   └── deployment-agent.md      # DeploymentAgent
│
├── commands/                    # カスタムスラッシュコマンド
│   ├── test.md                  # /test - テスト実行
│   ├── agent-run.md             # /agent-run - Agent実行
│   ├── deploy.md                # /deploy - デプロイ
│   ├── verify.md                # /verify - 動作確認
│   ├── security-scan.md         # /security-scan - セキュリティスキャン
│   ├── generate-docs.md         # /generate-docs - ドキュメント生成
│   └── create-issue.md          # /create-issue - Issue作成
│
├── hooks/                       # Claude Hooks
│   ├── auto-format.sh           # 自動フォーマット
│   ├── log-commands.sh          # コマンドログ
│   └── validate-typescript.sh   # TypeScript検証
│
└── docs/                        # ドキュメント
    ├── CLAUDE_WORKFLOW.md       # Claudeワークフロー
    └── AGENT_PATTERNS.md        # Agentパターン
```

## 🤖 Agent定義

### 階層構造

```
Human Layer (戦略・承認)
    ├── TechLead
    ├── PO
    └── CISO
        ↓ Escalation
Coordinator Layer
    └── CoordinatorAgent (タスク分解・並行実行制御)
        ↓ Assignment
Specialist Layer
    ├── CodeGenAgent (AI駆動コード生成)
    ├── ReviewAgent (品質評価・80点基準)
    ├── IssueAgent (Issue分析・Label付与)
    ├── PRAgent (PR自動作成)
    └── DeploymentAgent (CI/CD・Firebase)
```

### Agent実行権限

| Agent | 権限 | エスカレーション先 |
|-------|------|------------------|
| CoordinatorAgent | 🟢 オーケストレーション | TechLead (循環依存時) |
| CodeGenAgent | 🔵 コード生成 | TechLead (アーキテクチャ問題) |
| ReviewAgent | 🟡 品質判定 | CISO (セキュリティ) |
| IssueAgent | 🟢 分析・Label | PO (ビジネス判断) |
| PRAgent | 🔵 PR作成 | TechLead (権限エラー) |
| DeploymentAgent | 🔴 本番デプロイ | CTO (本番環境) |

## 🎯 カスタムコマンド

### /test
プロジェクト全体のテストを実行します。

```bash
npm run typecheck  # TypeScript型チェック
npm test           # Vitestテストスイート
```

### /agent-run
Autonomous Agent を実行します。

```bash
# 単一Issue処理
npm run agents:parallel:exec -- --issue 123

# 複数Issue並行処理
npm run agents:parallel:exec -- --issues 123,124,125 --concurrency 3

# Dry run
npm run agents:parallel:exec -- --issue 123 --dry-run
```

### /deploy
デプロイメントを実行します。

```bash
# Staging環境へデプロイ
npm run deploy:staging

# Production環境へデプロイ（CTOエスカレーション）
npm run deploy:production
```

### /verify
システム動作確認を実行します。

```bash
npm run typecheck
npm test
npm run agents:parallel:exec -- --help
```

## 🔌 MCP Servers

### 設定ファイル
`.claude/mcp.json` にMCPサーバーが定義されています。

### 利用可能なMCPサーバー

| MCP Server | 機能 | 提供ツール |
|------------|------|-----------|
| **IDE Integration** | VS Code診断、Jupyter実行 | `mcp__ide__getDiagnostics`, `mcp__ide__executeCode` |
| **GitHub Enhanced** | Issue/PR管理 | Issue操作、PR作成、Projects V2統合 |
| **Project Context** | 依存関係情報 | package.json解析、依存グラフ |
| **Filesystem** | ファイルアクセス | ファイル読み書き、検索 |
| **Context Engineering** | AIコンテキスト分析・最適化 | セマンティック検索、コンテキスト最適化、品質分析 |

### Context Engineering MCP の特徴

**目的**: コンテキストが不足している時の情報探索ツール

**主要機能**:
- 🧪 **AI駆動分析**: セマンティック一貫性、情報密度、明瞭度スコアリング
- ⚡ **インテリジェント最適化**: トークン効率52%向上、応答速度2倍
- 📋 **セマンティック検索**: Gemini AI搭載のコンテキスト検索
- 🎯 **品質評価**: コンテキスト品質スコア (0-100)

**利用可能なツール**:
- `search_guides_with_gemini` - セマンティック検索
- `analyze_guide` - ガイド分析
- `analyze_guide_url` - 外部コンテンツ分析
- `compare_guides` - 複数ガイド比較

**使用例**:
```
"Geminiを使ってAIエージェントに関するガイドを検索"
"OpenAI GPTベストプラクティスガイドを分析"
"OpenAIとGoogleのAIガイドを比較"
```

**APIサーバー**:
Context Engineering MCPは `http://localhost:8888` で動作するAPIサーバーと連携します。

```bash
# APIサーバー起動
cd external/context-engineering-mcp
uvicorn main:app --port 8888
```

### MCPサーバーの有効化/無効化

`.claude/mcp.json` の `disabled` フラグで制御:

```json
{
  "mcpServers": {
    "context-engineering": {
      "disabled": false  // true で無効化
    }
  }
}
```

## 🪝 Hooks設定

### auto-format.sh
コミット前に自動フォーマット実行（ESLint, Prettier）

### log-commands.sh
すべてのコマンドを`.ai/logs/`に記録（LDD準拠）

### validate-typescript.sh
TypeScriptコンパイルエラーをチェック

## 📊 品質基準

### Review基準（80点以上合格）

```typescript
質スコア計算:
  基準点: 100点
  - ESLintエラー: -20点/件
  - TypeScriptエラー: -30点/件
  - Critical脆弱性: -40点/件
  合格ライン: 80点以上
```

### エスカレーション基準

| 問題種別 | エスカレーション先 | 重要度 |
|---------|------------------|--------|
| アーキテクチャ問題 | TechLead | Sev.2-High |
| セキュリティ脆弱性 | CISO | Sev.1-Critical |
| ビジネス優先度 | PO | Sev.3-Medium |
| 本番デプロイ | CTO | Sev.1-Critical |

## 🚀 使い方

### 1. 初期設定

```bash
# 設定ファイルコピー
cp .claude/settings.example.json .claude/settings.local.json

# 環境変数設定
cp .env.example .env
vim .env  # API keys設定
```

### 2. カスタムコマンド実行

```bash
# Claude Code内で実行
/test          # テスト実行
/agent-run     # Agent実行
/verify        # 動作確認
/deploy        # デプロイ
```

### 3. フック有効化

```bash
cd .claude/hooks
chmod +x *.sh

# Gitフックとして登録（オプション）
ln -s ../../.claude/hooks/auto-format.sh ../../.git/hooks/pre-commit
```

## 📚 関連ドキュメント

- [README.md](../README.md) - プロジェクト概要
- [AGENTS.md](../AGENTS.md) - Agent運用プロトコル
- [docs/AGENT_OPERATIONS_MANUAL.md](../docs/AGENT_OPERATIONS_MANUAL.md) - 完全運用マニュアル
- [DEPLOYMENT.md](../DEPLOYMENT.md) - デプロイガイド
- [CONTRIBUTING.md](../CONTRIBUTING.md) - 貢献ガイド

## 🔐 セキュリティ

**重要**: `settings.local.json` は機密情報を含むため `.gitignore` で除外されています。

### 推奨設定

```json
{
  "projectContext": "Autonomous Operations Platform",
  "workingDirectory": "/Users/shunsuke/Dev/Autonomous-Operations",
  "preferredStyle": {
    "typescript": "strict",
    "commitMessage": "conventional"
  },
  "hooks": {
    "userPromptSubmit": ".claude/hooks/log-commands.sh"
  }
}
```

## 🎓 チュートリアル

### 新規プロジェクト作成からAgent実行まで

#### スラッシュコマンドを使う

```
/agent-run
→ Claude Codeが対話的にIssue番号を聞いて実行
```

---

**最終更新**: 2025-10-09

🤖 Generated with [Claude Code](https://claude.com/claude-code)
