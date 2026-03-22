/**
 * Custom tool: calendar.v4.calendarEvent.list
 *
 * Lists calendar events with full details (title, description, start/end time, etc.)
 * for a given time range. Requires user access token (UAT).
 *
 * Lark REST API: GET /open-apis/calendar/v4/calendars/{calendar_id}/events
 * Docs: https://open.larksuite.com/document/server-docs/calendar-v4/calendar-event/list
 */

import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import type { CustomTool } from './index.js';

interface LarkEvent {
  event_id?: string;
  summary?: string;
  description?: string;
  start_time?: { timestamp?: string; date?: string };
  end_time?: { timestamp?: string; date?: string };
  location?: { name?: string };
  status?: string;
  is_all_day?: boolean;
  organizer_calendar_id?: string;
}

interface LarkEventListResponse {
  code: number;
  msg?: string;
  data?: {
    items?: LarkEvent[];
    has_more?: boolean;
    page_token?: string;
  };
}

function formatTime(t: { timestamp?: string; date?: string } | undefined): string {
  if (!t) return '不明';
  if (t.date) return t.date; // all-day event
  if (t.timestamp) {
    const d = new Date(Number(t.timestamp) * 1000);
    return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  }
  return '不明';
}

function formatEvent(ev: LarkEvent, index: number): string {
  const lines: string[] = [
    `${index}. ${ev.summary ?? '（タイトルなし）'}`,
    `   開始: ${formatTime(ev.start_time)}`,
    `   終了: ${formatTime(ev.end_time)}`,
  ];
  if (ev.location?.name) lines.push(`   場所: ${ev.location.name}`);
  if (ev.description) lines.push(`   説明: ${ev.description.slice(0, 100)}${ev.description.length > 100 ? '…' : ''}`);
  if (ev.event_id) lines.push(`   ID: ${ev.event_id}`);
  return lines.join('\n');
}

export const calendarEventListTool: CustomTool = {
  name: 'calendar.v4.calendarEvent.list',
  description:
    'ユーザーのカレンダーから予定の一覧（タイトル・日時・場所・説明など詳細）を取得します。' +
    'start_time と end_time で絞り込めます（Unix タイムスタンプ文字列）。' +
    'ユーザー認証（UAT）が必要です。',
  parameters: {
    type: 'object',
    properties: {
      calendar_id: {
        type: 'string',
        description:
          'カレンダーID。省略すると自動的にプライマリカレンダーを使用。',
      },
      start_time: {
        type: 'string',
        description:
          '取得開始時刻（Unix タイムスタンプ、秒単位の文字列）。例: "1700000000"',
      },
      end_time: {
        type: 'string',
        description:
          '取得終了時刻（Unix タイムスタンプ、秒単位の文字列）。例: "1700086400"',
      },
      page_size: {
        type: 'number',
        description: '1回の取得件数（最大500、デフォルト50）。',
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
      return 'Error: カレンダー予定一覧の取得にはユーザー認証が必要です。';
    }

    try {
      // Step 1: resolve calendar_id (fetch calendar list and find primary if not provided)
      let calendarId = typeof params.calendar_id === 'string' && params.calendar_id.trim()
        ? params.calendar_id.trim()
        : null;

      if (!calendarId) {
        const listRes = await fetch(
          `${config.larkDomain}/open-apis/calendar/v4/calendars`,
          {
            headers: { Authorization: `Bearer ${userAccessToken}` },
          }
        );
        if (!listRes.ok) {
          return `Error: カレンダー一覧取得に失敗しました (HTTP ${listRes.status})`;
        }
        const listData = await listRes.json() as {
          code: number;
          msg?: string;
          data?: { calendar_list?: Array<{ calendar?: { calendar_id?: string; type?: string } }> };
        };
        if (listData.code !== 0) {
          return `Error: Lark API エラー [code: ${listData.code}] ${listData.msg ?? ''}`;
        }
        const calendars = listData.data?.calendar_list ?? [];
        const primary = calendars.find((c) => c.calendar?.type === 'primary') ?? calendars[0];
        calendarId = primary?.calendar?.calendar_id ?? null;
        if (!calendarId) {
          return 'Error: プライマリカレンダーIDが取得できませんでした。';
        }
      }

      // Step 2: list events
      // Convert any date/timestamp representation to Unix timestamp (seconds string)
      const toUnixSec = (v: unknown): string | null => {
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        if (!s) return null;
        // Pure digits: seconds (10 digits) or milliseconds (13 digits)
        if (/^\d+$/.test(s)) {
          const n = Number(s);
          return s.length >= 13 ? String(Math.floor(n / 1000)) : s;
        }
        // ISO 8601 or any parseable date string
        const ms = Date.parse(s);
        if (!isNaN(ms)) return String(Math.floor(ms / 1000));
        return null;
      };

      const query = new URLSearchParams();
      const now = Math.floor(Date.now() / 1000);
      const startTs = toUnixSec(params.start_time) ?? String(now);
      const endTs = toUnixSec(params.end_time) ?? String(now + 7 * 24 * 60 * 60);
      query.set('start_time', startTs);
      query.set('end_time', endTs);
      const pageSize = typeof params.page_size === 'number' ? params.page_size : 50;
      query.set('page_size', String(Math.min(Math.max(pageSize, 1), 500)));

      const url = `${config.larkDomain}/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`;
      logger.debug(`calendarEvent.list → GET ${url}`);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${userAccessToken}` },
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        logger.warn(`calendarEvent.list HTTP ${res.status}: ${errBody}`);
        return `Error: 予定一覧取得に失敗しました (HTTP ${res.status}): ${errBody}`;
      }

      const data = await res.json() as LarkEventListResponse;
      if (data.code !== 0) {
        return `Error: Lark API エラー [code: ${data.code}] ${data.msg ?? ''}`;
      }

      const events = data.data?.items ?? [];
      if (events.length === 0) {
        return '指定期間に予定はありません。';
      }

      const lines: string[] = [
        `カレンダー予定一覧（${events.length}件${data.data?.has_more ? '、続きあり' : ''}）:`,
        '',
        ...events.map((ev, i) => formatEvent(ev, i + 1)),
      ];
      return lines.join('\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('calendarEventListTool error', undefined, err as Error);
      return `Error: ${message}`;
    }
  },
};
