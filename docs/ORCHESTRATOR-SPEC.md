# 自律型オーケストレーションシステム 仕様書

**バージョン**: 1.0.0
**作成日**: 2026-03-20
**ステータス**: Draft

---

## 目次

1. [概要](#1-概要)
2. [アーキテクチャ](#2-アーキテクチャ)
3. [レイヤー詳細](#3-レイヤー詳細)
   - [Cron トリガー](#31-cron-トリガー)
   - [オーケストレーター](#32-オーケストレーター)
   - [情報収集レイヤー](#33-情報収集レイヤー)
   - [判断レイヤー](#34-判断レイヤー)
   - [実行エージェント](#35-実行エージェント)
   - [状態管理 (Bitable)](#36-状態管理-bitable)
   - [報告・レビューループ](#37-報告レビューループ)
4. [データモデル](#4-データモデル)
5. [API仕様](#5-api仕様)
6. [ファイル構成](#6-ファイル構成)
7. [環境変数](#7-環境変数)
8. [既存コンポーネントとの関係](#8-既存コンポーネントとの関係)
9. [フェーズ計画](#9-フェーズ計画)
10. [エラーハンドリング](#10-エラーハンドリング)
11. [検証方法](#11-検証方法)

---

## 1. 概要

### 目的

Lark テナント内の情報（カレンダー・タスク・チャットメッセージ）を定期的に収集し、GLM-4.7 が自律的に分析・優先度付け・タスク実行を行うシステムを構築する。人間の介入は最終レビューのみに限定し、日常的な繰り返しタスクを自動化する。

### 対象領域

| 機能 | 説明 |
|------|------|
| 自動情報収集 | Lark Calendar・Tasks・メッセージから情報を集約 |
| インテリジェントな分析 | GLM-4.7 がタスク抽出・重複排除・優先度判断を実施 |
| 自律実行 | タスク管理・カレンダー操作・Bitable 更新を自動実行 |
| 人間レビュー | 実行結果を Lark チャットに送信、承認/差し戻しだけ |

### 設計原則

- **既存コードの最大再利用**: `ToolExecutor`・`LLMService`・MCP ツール群を流用
- **Lark ネイティブ**: 外部サービスへの依存なし、Lark エコシステムで完結
- **段階的拡張**: Phase 1 MVP → Phase 2 レビューループ → Phase 3 外部連携
- **冪等性**: 同じデータを複数回処理してもタスクが重複しない設計

---

## 2. アーキテクチャ

### 全体フロー

```
┌─────────────────────────────────────────────────────────┐
│                    Vercel Cron Jobs                      │
│                  毎朝 9:00 JST (UTC 0:00)               │
└────────────────────────┬────────────────────────────────┘
                         │ GET /api/cron
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   Orchestrator                           │
│              src/orchestrator/index.ts                   │
└──┬──────────────────────────────────────────────────────┘
   │
   ├── [情報収集レイヤー] ─ 並列実行
   │   ├── Calendar Collector  → Lark Calendar API
   │   ├── Tasks Collector     → Lark Tasks API
   │   └── Messages Collector  → Lark IM API
   │
   ├── [判断レイヤー] ─ GLM-4.7 による分析
   │   ├── タスク抽出
   │   ├── 重複排除 (Bitable 照合)
   │   ├── 優先度判断 (1:高 / 2:中 / 3:低)
   │   └── 担当振り分け (AI / 人間)
   │
   ├── [実行部隊レイヤー] ─ AI 担当タスクを並列実行
   │   ├── TaskAgent      → Lark Tasks 作成・更新
   │   ├── CalendarAgent  → Lark Calendar 操作
   │   └── BitableAgent   → Bitable レコード更新
   │
   ├── [状態管理]
   │   └── OrchestratorState → Lark Bitable (タスクトラッカー)
   │
   └── [報告]
       └── Lark IM → レビューチャット にサマリーを送信
                         │
                         ▼
              ┌──────────────────┐
              │  人間 (Lark)     │
              │  承認 / 差し戻し │
              └────────┬─────────┘
                       │ メッセージ返信
                       ▼
              既存 Webhook → MessageProcessor
```

### コンポーネント間依存関係

```
api/cron.ts
  └── Orchestrator
        ├── collectAll()
        │     ├── CalendarCollector  ─ uses ToolExecutor
        │     ├── TasksCollector     ─ uses ToolExecutor
        │     └── MessagesCollector  ─ uses ToolExecutor
        ├── analyze()              ─ uses LLMService
        ├── OrchestratorState      ─ uses ToolExecutor
        └── Agents
              ├── TaskAgent         ─ uses ToolExecutor + LLMService
              ├── CalendarAgent     ─ uses ToolExecutor + LLMService
              └── BitableAgent      ─ uses ToolExecutor
```

---

## 3. レイヤー詳細

### 3.1 Cron トリガー

**ファイル**: `api/cron.ts`
**エンドポイント**: `GET /api/cron`

```
Vercel Cron → GET /api/cron → Orchestrator.run()
```

**仕様**:

| 項目 | 値 |
|------|---|
| スケジュール | `0 0 * * *`（UTC 0:00 = JST 9:00）|
| 認証 | `Authorization: Bearer {CRON_SECRET}` ヘッダー検証（本番必須） |
| タイムアウト | 300秒（`vercel.json` に設定）|
| 失敗時 | ログ記録のみ、Vercel が自動リトライ |

**レスポンス**:

```json
// 成功
{ "ok": true, "tasksProcessed": 5, "durationMs": 12340 }

// 失敗
{ "ok": false, "error": "Collection failed: ..." }
```

**vercel.json への追記**:

```json
{
  "crons": [
    { "path": "/api/cron", "schedule": "0 0 * * *" }
  ],
  "functions": {
    "api/cron.ts": { "maxDuration": 300 }
  }
}
```

---

### 3.2 オーケストレーター

**ファイル**: `src/orchestrator/index.ts`
**クラス**: `Orchestrator`

```typescript
class Orchestrator {
  constructor(config: OrchestratorConfig)

  // メインエントリ。全フローを順番に実行
  async run(): Promise<OrchestratorResult>

  // Phase 1: 情報収集（並列）
  private async collect(): Promise<CollectedData>

  // Phase 2: LLM による分析・タスク計画生成
  private async analyze(data: CollectedData): Promise<TaskPlan>

  // Phase 3: 重複排除（Bitable 照合）
  private async dedup(plan: TaskPlan): Promise<TaskPlan>

  // Phase 4: エージェント実行（AI 担当タスクのみ）
  private async execute(plan: TaskPlan): Promise<ExecutionResult>

  // Phase 5: Lark チャットへ報告メッセージ送信
  private async report(result: ExecutionResult): Promise<void>
}
```

**LLM プロンプト設計（analyze フェーズ）**:

- 収集データ（Calendar イベント・Tasks・Messages）を JSON で渡す
- 指示：タスク抽出、重複の検出、優先度スコア付け、担当（AI/人間）判定
- 出力形式：構造化 JSON（`TaskPlan` 型）で返させる

```
System:
  あなたは業務自動化オーケストレーターです。
  収集された Lark データを分析し、アクションが必要なタスクを抽出してください。
  出力は必ず以下の JSON 形式で返してください。

User:
  ## 収集データ
  ### カレンダー（今後7日間のイベント）
  {calendar_events}

  ### タスク（未完了のもの）
  {tasks}

  ### 最近のメッセージ（過去24時間）
  {messages}

  ## 指示
  上記から実行すべき作業を抽出し、以下を判定してください：
  1. title: タスクのタイトル
  2. source: 収集元 (calendar/tasks/message)
  3. assignee: AI が実行可能か human が必要か
  4. priority: 1(高) / 2(中) / 3(低)
  5. agent: 担当エージェント (task/calendar/bitable)
  6. action: 具体的な実行内容
```

---

### 3.3 情報収集レイヤー

**ファイル**: `src/orchestrator/collectors/`

#### CalendarCollector (`collectors/calendar.ts`)

| 項目 | 内容 |
|------|------|
| 使用ツール | `calendar.v4.calendarEvent.get`, `calendar.v4.freebusy.list` |
| 取得範囲 | 実行時刻から7日後まで |
| 出力 | `CalendarEvent[]` |

#### TasksCollector (`collectors/tasks.ts`)

| 項目 | 内容 |
|------|------|
| 使用ツール | `task.v2.task.list`（カスタムツール）|
| 取得対象 | ステータスが未完了のタスク |
| 出力 | `LarkTask[]` |

#### MessagesCollector (`collectors/messages.ts`)

| 項目 | 内容 |
|------|------|
| 使用ツール | `im.v1.message.list` |
| 取得対象 | `ORCHESTRATOR_MONITOR_CHAT_IDS` で指定したチャット（過去24時間）|
| 出力 | `LarkMessage[]` |

#### 並列収集 (`collectors/index.ts`)

```typescript
export async function collectAll(executor: ToolExecutor): Promise<CollectedData> {
  const [calendar, tasks, messages] = await Promise.all([
    collectCalendar(executor),
    collectTasks(executor),
    collectMessages(executor),
  ]);
  return { calendar, tasks, messages, collectedAt: Date.now() };
}
```

---

### 3.4 判断レイヤー

**処理場所**: `Orchestrator.analyze()` + `Orchestrator.dedup()`

**タスク抽出ロジック**:

1. 収集データを LLM に渡す
2. LLM が `TaskPlan`（タスクリスト）を JSON で返す
3. Bitable 上の既存レコードと照合（タイトルの類似度チェック）
4. 重複判定されたタスクを `status: skipped` でマーク
5. 残ったタスクを `priority` 昇順にソート

**担当振り分け基準**（LLM 判定）:

| 条件 | 担当 |
|------|------|
| Lark API で完結する操作 | AI |
| 外部判断・承認が必要な操作 | 人間 |
| 金銭的影響がある操作 | 人間 |
| 創造的コンテンツ作成 | 人間（Phase 1 では対象外）|

---

### 3.5 実行エージェント

**ファイル**: `src/orchestrator/agents/`

#### BaseAgent (`agents/base.ts`)

```typescript
abstract class BaseAgent {
  constructor(
    protected llm: LLMService,
    protected executor: ToolExecutor,
    protected state: OrchestratorState,
  ) {}

  abstract execute(task: OrchTask): Promise<AgentResult>

  protected async callTool(name: string, args: unknown): Promise<string> {
    return this.executor.executeToolCall(name, args);
  }
}
```

#### TaskAgent (`agents/task-agent.ts`)

| 操作 | 使用ツール |
|------|-----------|
| タスク作成 | `task.v2.task.create` |
| タスク更新 | `task.v2.task.patch` |
| リマインダー追加 | `task.v2.task.addReminders` |
| メンバー追加 | `task.v2.task.addMembers` |

**実行フロー**:
1. LLM にタスク詳細の生成を依頼（`due_date`・`summary`・`description` 等）
2. `task.v2.task.create` でタスクを作成
3. `OrchestratorState.updateTask()` で Bitable に結果を記録

#### CalendarAgent (`agents/calendar-agent.ts`)

| 操作 | 使用ツール |
|------|-----------|
| イベント作成 | `calendar.v4.calendarEvent.create` |
| イベント更新 | `calendar.v4.calendarEvent.patch` |
| 空き時間確認 | `calendar.v4.freebusy.list` |

**実行フロー**:
1. `calendar.v4.freebusy.list` で対象者の空き時間を確認
2. 空きスロットを LLM に渡して最適な時間帯を選択
3. `calendar.v4.calendarEvent.create` でイベントを作成

#### BitableAgent (`agents/bitable-agent.ts`)

| 操作 | 使用ツール |
|------|-----------|
| レコード作成 | `bitable.v1.appTableRecord.create` |
| レコード更新 | `bitable.v1.appTableRecord.update` |
| レコード検索 | `bitable.v1.appTableRecord.search` |

**役割**: タスクトラッカー Bitable の CRUD 操作を担当。`OrchestratorState` の内部実装として機能。

---

### 3.6 状態管理 (Bitable)

**ファイル**: `src/orchestrator/state.ts`
**クラス**: `OrchestratorState`

Lark Bitable をタスクトラッカーとして使用。実行ログ・重複チェック・ステータス管理をすべて Bitable で一元管理。

```typescript
class OrchestratorState {
  constructor(private executor: ToolExecutor, private config: StateConfig) {}

  // 同一タイトルのタスクが Bitable に存在するか確認
  async isDuplicate(taskTitle: string): Promise<boolean>

  // 新しいタスクレコードを Bitable に作成
  async createTask(task: OrchTask): Promise<string>  // → record_id

  // タスクのステータスを更新
  async updateTask(recordId: string, updates: Partial<OrchTask>): Promise<void>

  // status が pending のタスク一覧を取得
  async getPendingTasks(): Promise<OrchTask[]>
}
```

---

### 3.7 報告・レビューループ

**Phase 1**: 一方向報告（Orchestrator → Lark チャット）

送信フォーマット（Lark Interactive Card または Rich Text）:

```
📊 オーケストレーター実行完了 [2026-03-20 09:00]

【実行サマリー】
✅ AI実行完了: 3件
⏳ 人間要対応: 2件
⏭️ 重複スキップ: 1件

【AI実行済みタスク】
1. [高] 週次レビューのカレンダー登録 → 完了
2. [中] 未完了タスクへのリマインダー追加 → 完了
3. [低] Bitableステータス更新 → 完了

【人間が対応すべきタスク】
1. [高] 予算承認依頼への返答
2. [中] 採用候補者の面接調整

詳細: {Bitable_URL}
```

**Phase 2（後続実装）**: 双方向レビューループ

- Lark の Interactive Card で「承認」「差し戻し」ボタン
- 返信を既存 Webhook で受信
- `MessageProcessor` が `[承認]` / `[差し戻し]` キーワードを検知
- `OrchestratorState.updateTask()` でステータス更新

---

## 4. データモデル

### Bitable タスクトラッカースキーマ

| フィールド名 | 型 | 必須 | 説明 |
|-------------|---|------|------|
| `task_id` | テキスト | ✓ | UUID v4 |
| `title` | テキスト | ✓ | タスクタイトル（重複チェックキー）|
| `source` | 単一選択 | ✓ | `calendar` / `tasks` / `message` |
| `status` | 単一選択 | ✓ | `pending` / `in_progress` / `done` / `rejected` / `skipped` |
| `assignee` | 単一選択 | ✓ | `AI` / `human` |
| `priority` | 数値 | ✓ | `1`（高）/ `2`（中）/ `3`（低）|
| `agent` | テキスト | - | 実行エージェント名（`task` / `calendar` / `bitable`）|
| `action` | テキスト | - | 実行した具体的な操作 |
| `result` | テキスト | - | 実行結果・エラー詳細 |
| `lark_task_id` | テキスト | - | 作成した Lark Task の ID |
| `lark_event_id` | テキスト | - | 作成した Lark Calendar Event の ID |
| `created_at` | 日時 | ✓ | 抽出日時 |
| `completed_at` | 日時 | - | 完了日時 |
| `run_id` | テキスト | ✓ | Cron 実行 ID（UUID）|

### TypeScript 型定義 (`src/orchestrator/types.ts`)

```typescript
export type TaskSource = 'calendar' | 'tasks' | 'message';
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'rejected' | 'skipped';
export type TaskAssignee = 'AI' | 'human';
export type AgentType = 'task' | 'calendar' | 'bitable';

export interface OrchTask {
  id: string;           // UUID
  recordId?: string;    // Bitable レコード ID（作成後に付与）
  title: string;
  source: TaskSource;
  status: TaskStatus;
  assignee: TaskAssignee;
  priority: 1 | 2 | 3;
  agent?: AgentType;
  action?: string;
  result?: string;
  larkTaskId?: string;
  larkEventId?: string;
  createdAt: number;    // Unix timestamp (ms)
  completedAt?: number;
  runId: string;
}

export interface CollectedData {
  calendar: CalendarEvent[];
  tasks: LarkTask[];
  messages: LarkMessage[];
  collectedAt: number;
}

export interface TaskPlan {
  tasks: OrchTask[];
  runId: string;
  analysisNote?: string;  // LLM の分析コメント
}

export interface AgentResult {
  success: boolean;
  taskId: string;
  output?: string;
  error?: string;
}

export interface ExecutionResult {
  runId: string;
  plan: TaskPlan;
  agentResults: AgentResult[];
  startedAt: number;
  completedAt: number;
}

export interface OrchestratorResult {
  ok: boolean;
  runId: string;
  tasksProcessed: number;
  tasksDone: number;
  tasksSkipped: number;
  tasksPendingHuman: number;
  durationMs: number;
  error?: string;
}

export interface OrchestratorConfig {
  reviewChatId: string;
  stateAppToken: string;
  stateTableId: string;
  monitorChatIds: string[];
  /** 本番環境では必須。未設定のまま NODE_ENV=production で起動すると例外 */
  cronSecret: string | undefined;
}

export interface StateConfig {
  appToken: string;
  tableId: string;
}
```

---

## 5. API仕様

### `GET /api/cron`

**用途**: Vercel Cron Jobs からの自動トリガー（手動実行も可）

**認証**:
```
Authorization: Bearer {CRON_SECRET}
```

Vercel Cron Jobs は `CRON_SECRET` 環境変数が設定されていると、リクエスト時に自動で `Authorization: Bearer {CRON_SECRET}` ヘッダーを付与する。

**認証ロジック（`api/cron.ts` 実装指針）**:

```typescript
const isProduction = process.env.NODE_ENV === 'production';
const cronSecret = process.env.CRON_SECRET;

// 本番環境で CRON_SECRET が未設定の場合は起動を拒否
if (isProduction && !cronSecret) {
  throw new Error('CRON_SECRET is required in production');
}

// シークレットが設定されていれば必ず検証（開発環境でも）
if (cronSecret) {
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
}
```

**ルール**:

| 環境 | `CRON_SECRET` | 動作 |
|------|--------------|------|
| 本番（Vercel） | 未設定 | 起動時に例外（デプロイ失敗） |
| 本番（Vercel） | 設定済み | ヘッダー検証必須 |
| 開発（local） | 未設定 | 認証スキップ（警告ログを出力） |
| 開発（local） | 設定済み | ヘッダー検証あり |

**レスポンス**:

| ステータス | 条件 | ボディ |
|-----------|------|--------|
| `200 OK` | 正常完了 | `{ ok: true, runId, tasksProcessed, durationMs }` |
| `200 OK` | 一部失敗 | `{ ok: true, ..., errors: [...] }` |
| `401 Unauthorized` | 認証失敗 | `{ ok: false, error: "Unauthorized" }` |
| `500 Internal Server Error` | 致命的エラー | `{ ok: false, error: "..." }` |

**処理フロー**:

```
1. Authorization ヘッダー検証
2. Orchestrator.run() 実行（非同期）
3. 結果をレスポンスとして返却
4. 実行ログを Redis に保存（run_id キー、TTL: 7日）
```

---

## 6. ファイル構成

### 新規追加ファイル

```
api/
└── cron.ts                           # Vercel Cron エントリポイント

src/orchestrator/
├── index.ts                          # Orchestrator クラス（メインフロー）
├── types.ts                          # 型定義（OrchTask, TaskPlan 等）
├── state.ts                          # OrchestratorState（Bitable 操作）
├── collectors/
│   ├── index.ts                      # collectAll()（並列実行）
│   ├── calendar.ts                   # CalendarCollector
│   ├── tasks.ts                      # TasksCollector
│   └── messages.ts                   # MessagesCollector
└── agents/
    ├── base.ts                       # BaseAgent 抽象クラス
    ├── task-agent.ts                 # TaskAgent
    ├── calendar-agent.ts             # CalendarAgent
    └── bitable-agent.ts              # BitableAgent
```

### 修正ファイル

```
vercel.json      → crons セクション追加、api/cron.ts の maxDuration 追加
src/config.ts    → OrchestratorConfig 向け環境変数を追加
```

---

## 7. 環境変数

### 新規追加

| 変数名 | 必須 | 説明 | 例 |
|--------|------|------|---|
| `ORCHESTRATOR_REVIEW_CHAT_ID` | ✓ | 実行結果を報告する Lark チャット ID | `oc_xxxxxxx` |
| `ORCHESTRATOR_STATE_APP_TOKEN` | ✓ | タスクトラッカー Bitable の app_token | `bascnxxxxxx` |
| `ORCHESTRATOR_STATE_TABLE_ID` | ✓ | タスクトラッカー Bitable の table_id | `tblxxxxxxxx` |
| `ORCHESTRATOR_MONITOR_CHAT_IDS` | - | メッセージ収集対象チャット（カンマ区切り）| `oc_aaa,oc_bbb` |
| `CRON_SECRET` | 本番必須 | Cron エンドポイントの認証シークレット。本番未設定は起動エラー | `s3cr3t` |

### 既存（変更なし）

| 変数名 | 用途 |
|--------|------|
| `LARK_APP_ID` / `LARK_APP_SECRET` | Lark API 認証 |
| `GLM_API_KEY` / `GLM_MODEL` | LLM 呼び出し |
| `KV_REST_API_URL` / `KV_REST_API_READ_ONLY_TOKEN` | Redis（実行ログ保存）|

---

## 8. 既存コンポーネントとの関係

### 再利用する既存コンポーネント

| コンポーネント | ファイル | 再利用方法 |
|--------------|---------|-----------|
| `ToolExecutor` | `src/bot/tool-executor.ts` | 全コレクター・全エージェントで MCP ツール呼び出しに使用 |
| `LLMService` | `src/bot/llm-service.ts` | `analyze()` フェーズとエージェントの LLM 呼び出し |
| `createStorage()` | `src/storage/index.ts` | 実行ログの Redis 保存 |
| エラークラス | `src/types.ts` | `ToolExecutionError`・`LLMError` 等をそのまま利用 |
| `LarkMCPBot` | `src/bot/index.ts` | レビュー返信（Phase 2）を既存 Webhook フローで受信 |

### 既存フローとの共存

```
既存フロー:
  Lark メッセージ → Webhook → LarkMCPBot → MessageProcessor → 返信

新規フロー:
  Vercel Cron → api/cron.ts → Orchestrator → Bitable + Lark メッセージ

共有リソース:
  - ToolExecutor インスタンス（独立して生成）
  - LLMService インスタンス（独立して生成）
  - Redis（既存: 会話履歴 / 新規: 実行ログ、キープレフィックスで分離）
```

---

## 9. フェーズ計画

### Phase 1 — MVP（初期実装）

| タスク | ファイル | 優先度 |
|--------|---------|--------|
| Cron エンドポイント作成 | `api/cron.ts` | 高 |
| Orchestrator 基本フロー | `src/orchestrator/index.ts` | 高 |
| 型定義 | `src/orchestrator/types.ts` | 高 |
| Calendar コレクター | `src/orchestrator/collectors/calendar.ts` | 高 |
| Tasks コレクター | `src/orchestrator/collectors/tasks.ts` | 高 |
| Messages コレクター | `src/orchestrator/collectors/messages.ts` | 中 |
| Bitable 状態管理 | `src/orchestrator/state.ts` | 高 |
| TaskAgent | `src/orchestrator/agents/task-agent.ts` | 高 |
| CalendarAgent | `src/orchestrator/agents/calendar-agent.ts` | 高 |
| BitableAgent | `src/orchestrator/agents/bitable-agent.ts` | 中 |
| レポート送信 | `src/orchestrator/index.ts` 内 | 中 |
| vercel.json 更新 | `vercel.json` | 高 |
| config.ts 更新 | `src/config.ts` | 高 |

### Phase 2 — 人間レビューループ

- Lark Interactive Card による承認/差し戻しボタン
- `MessageProcessor` でのレビュー返信検知
- 差し戻しタスクの再キュー・再実行

### Phase 3 — 拡張

- 外部サービスアダプター（必要時に追加）
- 実行頻度の調整（複数 Cron スケジュール）
- 実行履歴ダッシュボード（Bitable ビュー活用）

---

## 10. エラーハンドリング

### エラー分類と対応

| エラー種別 | クラス | 対応 |
|-----------|-------|------|
| 収集失敗（一部）| `ToolExecutionError` | 収集可能な分で続行、エラーをログ記録 |
| LLM タイムアウト | `LLMError` | リトライ最大3回（既存ロジック）|
| エージェント実行失敗 | `ToolExecutionError` | タスクを `status: pending` のまま残す |
| Bitable 書き込み失敗 | `ToolExecutionError` | Redis にフォールバックで記録 |
| 致命的エラー | `LarkBotError` | Cron は 500 を返し、Vercel がリトライ |

### 部分失敗の考え方

- コレクターの一部が失敗しても、成功した収集データで処理続行
- エージェントの一部が失敗しても、他のタスクの実行は継続
- 全体の成功/失敗サマリーを報告メッセージに含める

---

## 11. 検証方法

### ユニットテスト

```bash
npm test -- tests/orchestrator.test.ts
```

テスト対象:
- `collectAll()` の並列実行と結果統合
- `OrchestratorState.isDuplicate()` の重複検出ロジック
- `TaskAgent.execute()` のパラメータ生成
- LLM 出力のパース（不正な JSON への耐性）

### 手動 E2E テスト

```bash
# 1. Cron エンドポイントを手動で叩く
curl -X GET http://localhost:3000/api/cron \
  -H "Authorization: Bearer your_cron_secret"

# 2. レスポンスを確認
# { "ok": true, "tasksProcessed": N, "durationMs": ... }

# 3. Bitable に新しいレコードが作成されているか確認

# 4. Lark レビューチャットに報告メッセージが届いているか確認
```

### TypeScript 型チェック

```bash
npm run typecheck
```

### Vercel 本番での確認

1. `vercel.json` の cron 設定をデプロイ後、Vercel Dashboard の「Cron Jobs」タブで次回実行時刻を確認
2. 実行後、Function Logs でエラーがないことを確認
3. Bitable とレビューチャットへの書き込みを確認
