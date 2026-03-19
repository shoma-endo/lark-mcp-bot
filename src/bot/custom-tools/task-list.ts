/**
 * Custom tool: task.v2.task.list
 *
 * Lists the user's own tasks with full details (title, due date, status, etc.)
 * Requires user access token (UAT).
 *
 * Lark REST API: GET /open-apis/task/v2/tasks
 * Docs: https://open.larksuite.com/document/server-docs/task-v2/task/list
 */

import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import type { CustomTool } from './index.js';

interface LarkTask {
  guid?: string;
  summary?: string;
  description?: string;
  due?: { timestamp?: string; is_all_day?: boolean };
  start?: { timestamp?: string; is_all_day?: boolean };
  completed_at?: string;
  status?: string;
  url?: string;
  members?: Array<{ id?: string; name?: string; role?: string }>;
}

interface LarkTaskListResponse {
  code: number;
  msg?: string;
  data?: {
    items?: LarkTask[];
    has_more?: boolean;
    page_token?: string;
  };
}

function formatTimestamp(ts: string | undefined): string {
  if (!ts || ts === '0') return '未設定';
  const d = new Date(Number(ts));
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

function formatTask(task: LarkTask, index: number): string {
  const lines: string[] = [
    `${index}. ${task.summary ?? '（タイトルなし）'}`,
  ];
  if (task.due?.timestamp && task.due.timestamp !== '0') {
    lines.push(`   期限: ${formatTimestamp(task.due.timestamp)}`);
  }
  if (task.start?.timestamp && task.start.timestamp !== '0') {
    lines.push(`   開始: ${formatTimestamp(task.start.timestamp)}`);
  }
  const statusLabel = task.completed_at && task.completed_at !== '0' ? '完了' : '未完了';
  lines.push(`   状態: ${statusLabel}`);
  if (task.description) {
    lines.push(`   説明: ${task.description.slice(0, 80)}${task.description.length > 80 ? '…' : ''}`);
  }
  if (task.guid) lines.push(`   ID: ${task.guid}`);
  return lines.join('\n');
}

export const taskListTool: CustomTool = {
  name: 'task.v2.task.list',
  description:
    '自分のタスク一覧を取得します（タイトル・期限・状態・説明など）。' +
    'completed=false で未完了のみ、completed=true で完了済みのみ取得できます。' +
    'ユーザー認証（UAT）が必要です。',
  parameters: {
    type: 'object',
    properties: {
      completed: {
        type: 'boolean',
        description: 'true=完了済みのみ、false=未完了のみ。省略すると全件取得。',
      },
      due_date: {
        type: 'string',
        description: '期限でフィルタ。ISO8601またはUnixタイムスタンプ（秒）。例: "2026-03-19" または "2026-03-19T00:00:00+09:00"。この日付が期限のタスクのみ返す。',
      },
      page_size: {
        type: 'number',
        description: '取得件数（1〜100、デフォルト50）。',
      },
    },
    required: [],
  },
  requiresUAT: true,

  async execute(
    params: Record<string, unknown>,
    userAccessToken?: string
  ): Promise<string> {
    if (!userAccessToken) {
      return 'Error: タスク一覧の取得にはユーザー認証が必要です。';
    }

    try {
      const query = new URLSearchParams({ type: 'my_tasks', user_id_type: 'open_id' });

      if (typeof params.completed === 'boolean') {
        query.set('completed', String(params.completed));
      }
      const pageSize = typeof params.page_size === 'number' ? params.page_size : 50;
      query.set('page_size', String(Math.min(Math.max(pageSize, 1), 100)));

      const url = `${config.larkDomain}/open-apis/task/v2/tasks?${query.toString()}`;
      logger.debug(`task.v2.task.list → GET ${url}`);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${userAccessToken}` },
      });
      if (!res.ok) {
        return `Error: タスク一覧取得に失敗しました (HTTP ${res.status})`;
      }

      const data = await res.json() as LarkTaskListResponse;
      if (data.code !== 0) {
        return `Error: Lark API エラー [code: ${data.code}] ${data.msg ?? ''}`;
      }

      let tasks = data.data?.items ?? [];
      if (tasks.length === 0) {
        return '該当するタスクはありません。';
      }

      // Client-side filtering by due_date
      const dueDateParam = params.due_date;
      if (typeof dueDateParam === 'string' && dueDateParam.trim()) {
        const target = new Date(/^\d+$/.test(dueDateParam.trim())
          ? Number(dueDateParam.trim()) * 1000
          : dueDateParam.trim());
        const targetDateStr = target.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });

        tasks = tasks.filter((t) => {
          const ts = t.due?.timestamp;
          if (!ts || ts === '0') return false;
          const dueDate = new Date(Number(ts));
          const dueDateStr = dueDate.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
          return dueDateStr === targetDateStr;
        });

        if (tasks.length === 0) {
          return `${targetDateStr}が期限のタスクはありません。`;
        }
      }

      const lines: string[] = [
        `タスク一覧（${tasks.length}件${data.data?.has_more ? '、続きあり' : ''}）:`,
        '',
        ...tasks.map((t, i) => formatTask(t, i + 1)),
      ];
      return lines.join('\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('taskListTool error', undefined, err as Error);
      return `Error: ${message}`;
    }
  },
};
