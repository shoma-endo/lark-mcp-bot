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

function formatTime(t: { timestamp?: string; date?: string } | undefined, isEnd = false): string {
  if (!t) return '不明';
  if (t.date) {
    // all-day event (YYYY-MM-DD format)
    const [year, month, day] = t.date.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    // For all-day events, the end date is exclusive (next day), so subtract 1 day if it's an end time
    if (isEnd) {
      d.setDate(d.getDate() - 1);
    }
    return `${d.getMonth() + 1}/${d.getDate()} (${['日', '月', '火', '水', '木', '金', '土'][d.getDay()]})`;
  }
  if (t.timestamp) {
    // Lark API returns Unix timestamps in seconds
    const d = new Date(Number(t.timestamp) * 1000);
    return d.toLocaleString('ja-JP', { 
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  return '不明';
}

function formatEvent(ev: LarkEvent, index: number): string {
  const isAllDay = !!ev.start_time?.date && !!ev.end_time?.date;
  const lines: string[] = [
    `${index}. ${ev.summary ?? '（タイトルなし）'}`,
    `   期間: ${formatTime(ev.start_time)} 〜 ${formatTime(ev.end_time, isAllDay)}`,
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
    'start_time と end_time で絞り込めます（Unix タイムスタンプ、秒単位）。' +
    '重要: 日付範囲の計算には、現在時刻を基準にして正確なUnixタイムスタンプを計算してください。' +
    '例: 「今日」なら現在日付の00:00:00から翌日の00:00:00まで、' +
    '「明日」なら明日の00:00:00から翌々日の00:00:00までです。' +
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
          '取得開始時刻（Unix タイムスタンプ、秒単位の文字列）。例: "1700000000"。現在時刻（秒）は Math.floor(Date.now() / 1000) で取得できます。',
      },
      end_time: {
        type: 'string',
        description:
          '取得終了時刻（Unix タイムスタンプ、秒単位の文字列）。例: "1700086400"。',
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
        logger.info('calendar_id が指定されていないため、カレンダーリストからプライマリカレンダーを検索します');
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
          data?: { calendar_list?: Array<{ calendar_id?: string; type?: string; summary?: string }> };
        };
        logger.info(`カレンダー一覧レスポンス: code=${listData.code}, calendars=${listData.data?.calendar_list?.length ?? 0}`);
        if (listData.code !== 0) {
          logger.error(`Lark API エラー: code=${listData.code}, msg=${listData.msg}`);
          return `Error: Lark API エラー [code: ${listData.code}] ${listData.msg ?? ''}`;
        }
        const calendars = listData.data?.calendar_list ?? [];
        logger.debug(`取得したカレンダーリスト: ${JSON.stringify(calendars.map(c => ({ calendar_id: c.calendar_id, type: c.type, summary: c.summary })))}`);
        const primary = calendars.find((c) => c.type === 'primary') ?? calendars[0];
        logger.info(`選択されたカレンダー: ${JSON.stringify({ calendar_id: primary?.calendar_id, type: primary?.type, summary: primary?.summary })}`);
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

      // Default to today's date range (00:00:00 to 23:59:59 in JST)
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      const defaultStartTs = String(Math.floor(startOfDay.getTime() / 1000));
      const defaultEndTs = String(Math.floor(endOfDay.getTime() / 1000));
      
      const startTs = toUnixSec(params.start_time) ?? defaultStartTs;
      const endTs = toUnixSec(params.end_time) ?? defaultEndTs;
      const pageSize = typeof params.page_size === 'number' ? params.page_size : 50;
      
      logger.info(`カレンダー予定取得パラメータ: calendar_id=${calendarId}, start_time=${startTs}, end_time=${endTs}, page_size=${pageSize}`);

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
