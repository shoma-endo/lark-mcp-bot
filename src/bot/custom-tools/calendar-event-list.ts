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
import type { LarkEvent, LarkEventListResponse } from '../../types/calendar.js';

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
          const errText = await listRes.text().catch(() => '');
          logger.error(`カレンダー一覧API HTTPエラー: ${listRes.status}`, undefined, undefined, { httpStatus: listRes.status, errorBody: errText });
          return `Error: カレンダー一覧取得に失敗しました (HTTP ${listRes.status})`;
        }
        const listData = await listRes.json() as {
          code: number;
          msg?: string;
          data?: { calendar_list?: Array<{ calendar_id?: string; type?: string }> };
        };
        logger.debug(`カレンダー一覧レスポンス: code=${listData.code}, calendars=${listData.data?.calendar_list?.length ?? 0}`);
        if (listData.code !== 0) {
          logger.error(`Lark API エラー: code=${listData.code}, msg=${listData.msg}`);
          return `Error: Lark API エラー [code: ${listData.code}] ${listData.msg ?? ''}`;
        }
        const calendars = listData.data?.calendar_list ?? [];
        logger.debug(`取得したカレンダーリスト: ${JSON.stringify(calendars)}`);
        const primary = calendars.find((c) => c.type === 'primary') ?? calendars[0];
        calendarId = primary?.calendar_id ?? null;
        if (!calendarId) {
          logger.error(`プライマリカレンダーIDが見つかりません。calendar_list=${JSON.stringify(calendars)}`);
          return 'Error: プライマリカレンダーIDが取得できませんでした。';
        }
      }

      // Step 2: list events with pagination
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

      const now = Math.floor(Date.now() / 1000);
      const startTs = toUnixSec(params.start_time) ?? String(now);
      const endTs = toUnixSec(params.end_time) ?? String(now + 7 * 24 * 60 * 60);
      const pageSize = typeof params.page_size === 'number' ? params.page_size : 50;

      let allEvents: LarkEvent[] = [];
      let pageToken: string | undefined;
      let pageCount = 0;
      const maxPages = 20; // Prevent infinite loops (20 pages * 500 = 10,000 events max)

      while (pageCount < maxPages) {
        const query = new URLSearchParams();
        query.set('start_time', startTs);
        query.set('end_time', endTs);
        query.set('page_size', String(Math.min(Math.max(pageSize, 1), 500)));
        if (pageToken) {
          query.set('page_token', pageToken);
        }

        const url = `${config.larkDomain}/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`;
        logger.debug(`calendarEvent.list → GET ${url} (page ${pageCount + 1})`);

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

        const pageEvents = data.data?.items ?? [];
        allEvents.push(...pageEvents);

        // Check if there are more pages
        pageToken = data.data?.page_token;
        if (!pageToken || !data.data?.has_more) {
          break;
        }
        pageCount++;
      }

      if (allEvents.length === 0) {
        return '指定期間に予定はありません。';
      }

      const truncated = pageCount >= maxPages && pageToken;
      const summaryText = `カレンダー予定一覧（${allEvents.length}件${truncated ? '（最大10,000件まで表示、それ以上は省略されています）' : ''}）:`;
      
      const lines: string[] = [
        summaryText,
        '',
        ...allEvents.map((ev, i) => formatEvent(ev, i + 1)),
      ];
      return lines.join('\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('calendarEventListTool error', undefined, err as Error);
      return `Error: ${message}`;
    }
  },
};
