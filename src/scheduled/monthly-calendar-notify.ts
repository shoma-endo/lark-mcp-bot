/**
 * Monthly Calendar Notification
 *
 * Fetches all calendar events for the current month (using a specified user's
 * OAuth token), filters out excluded titles, formats a summary grouped by date,
 * and sends the result to a Lark group chat.
 */

import * as lark from '@larksuiteoapi/node-sdk';
import { config, NOTIFY_CHAT_ID } from '../config.js';
import { getValidAccessToken } from '../bot/uat-tools.js';
import { logger } from '../utils/logger.js';
import type { LarkEvent, LarkEventListResponse } from '../types/calendar.js';

/** Titles to exclude from the notification. */
const EXCLUDED_TITLES = ['モビルス', 'EMB勉強会', '髭剃る', '爪切る'];

/** Japanese day-of-week labels. */
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// ---------------------------------------------------------------------------
// Helper: fetch primary calendar ID
// ---------------------------------------------------------------------------

async function fetchPrimaryCalendarId(uat: string): Promise<string> {
  const res = await fetch(
    `${config.larkDomain}/open-apis/calendar/v4/calendars`,
    { headers: { Authorization: `Bearer ${uat}` } },
  );
  if (!res.ok) {
    throw new Error(`Failed to list calendars (HTTP ${res.status})`);
  }
  const body = (await res.json()) as {
    code: number;
    msg?: string;
    data?: {
      calendar_list?: Array<{
        calendar?: { calendar_id?: string; type?: string };
      }>;
    };
  };
  if (body.code !== 0) {
    throw new Error(`Lark calendar list error [${body.code}] ${body.msg ?? ''}`);
  }
  const calendars = body.data?.calendar_list ?? [];
  const primary =
    calendars.find((c) => c.calendar?.type === 'primary') ?? calendars[0];
  const id = primary?.calendar?.calendar_id;
  if (!id) throw new Error('Primary calendar ID not found');
  return id;
}

// ---------------------------------------------------------------------------
// Helper: fetch all events for a month (with pagination)
// ---------------------------------------------------------------------------

async function fetchAllEventsForMonth(
  uat: string,
  calendarId: string,
  startTime: string,
  endTime: string,
): Promise<LarkEvent[]> {
  const events: LarkEvent[] = [];
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({
      start_time: startTime,
      end_time: endTime,
      page_size: '500',
    });
    if (pageToken) query.set('page_token', pageToken);

    const url = `${config.larkDomain}/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`;
    logger.debug('monthlyCalendar: fetching events', { url } as any);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${uat}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch events (HTTP ${res.status})`);
    }

    const data = (await res.json()) as LarkEventListResponse;
    if (data.code !== 0) {
      throw new Error(`Lark event list error [${data.code}] ${data.msg ?? ''}`);
    }

    if (data.data?.items) {
      events.push(...data.data.items);
    }

    pageToken = data.data?.has_more ? data.data.page_token ?? undefined : undefined;
  } while (pageToken);

  return events;
}

// ---------------------------------------------------------------------------
// Helper: filter events
// ---------------------------------------------------------------------------

function filterEvents(events: LarkEvent[]): LarkEvent[] {
  return events.filter((ev) => {
    // Exclude cancelled events
    if (ev.status === 'cancelled') return false;
    // Exclude by title
    const title = ev.summary ?? '';
    return !EXCLUDED_TITLES.some((ex) => title.includes(ex));
  });
}

// ---------------------------------------------------------------------------
// Helper: format the notification text
// ---------------------------------------------------------------------------

function eventTimeStr(ev: LarkEvent): string {
  if (ev.is_all_day) return '[終日]';

  const fmt = (t?: { timestamp?: string; date?: string }): string => {
    if (!t) return '??:??';
    if (t.timestamp) {
      const d = new Date(Number(t.timestamp) * 1000);
      return d.toLocaleTimeString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }
    if (t.date) return t.date;
    return '??:??';
  };

  return `${fmt(ev.start_time)}-${fmt(ev.end_time)}`;
}

function eventDateKey(ev: LarkEvent): string {
  // For grouping – returns YYYY-MM-DD in JST
  const t = ev.start_time;
  if (!t) return '9999-99-99';
  if (t.date) return t.date; // all-day: "2026-04-01"
  if (t.timestamp) {
    const d = new Date(Number(t.timestamp) * 1000);
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().slice(0, 10);
  }
  return '9999-99-99';
}

export function formatMonthlyNotification(
  year: number,
  month: number,
  events: LarkEvent[],
): string {
  if (events.length === 0) {
    return `📅 ${year}年${month}月のカレンダー予定はありません。`;
  }

  // Group by date
  const grouped = new Map<string, LarkEvent[]>();
  for (const ev of events) {
    const key = eventDateKey(ev);
    const list = grouped.get(key) ?? [];
    list.push(ev);
    grouped.set(key, list);
  }

  // Sort dates
  const sortedDates = [...grouped.keys()].sort();

  const lines: string[] = [
    `📅 ${year}年${month}月のカレンダー予定（${events.length}件）`,
    '',
  ];

  for (const dateStr of sortedDates) {
    const d = new Date(dateStr + 'T00:00:00+09:00');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dow = DAY_NAMES[d.getDay()];
    lines.push(`── ${mm}/${dd} (${dow}) ──────────`);

    const dayEvents = grouped.get(dateStr)!;
    // Sort by start time within the day
    dayEvents.sort((a, b) => {
      if (a.is_all_day && !b.is_all_day) return -1;
      if (!a.is_all_day && b.is_all_day) return 1;
      const aTs = Number(a.start_time?.timestamp ?? 0);
      const bTs = Number(b.start_time?.timestamp ?? 0);
      return aTs - bTs;
    });

    for (const ev of dayEvents) {
      const time = eventTimeStr(ev);
      const title = ev.summary ?? '（タイトルなし）';
      lines.push(`${time}  ${title}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Helper: create Lark client (tenant token)
// ---------------------------------------------------------------------------

function createLarkClient(): lark.Client {
  return new lark.Client({
    appId: config.larkAppId,
    appSecret: config.larkAppSecret,
    domain: config.larkDomain,
  });
}

// ---------------------------------------------------------------------------
// Helper: resolve target user open_id from chat members
// ---------------------------------------------------------------------------

async function resolveUserOpenId(
  client: lark.Client,
  chatId: string,
): Promise<string> {
  const res = await client.im.chatMembers.get({
    path: { chat_id: chatId },
    params: { member_id_type: 'open_id' },
  });

  const members = (res?.data?.items ?? []) as Array<{
    member_id?: string;
    member_id_type?: string;
    name?: string;
    tenant_key?: string;
  }>;

  // Filter out bot members — bots have no tenant_key or name starts with bot app_id
  // The simplest heuristic: pick the first member whose member_id starts with "ou_"
  const user = members.find((m) => m.member_id?.startsWith('ou_'));
  if (!user?.member_id) {
    throw new Error(
      `No user member found in chat ${chatId} (${members.length} members total)`,
    );
  }
  return user.member_id;
}

// ---------------------------------------------------------------------------
// Helper: send notification via Lark
// ---------------------------------------------------------------------------

async function sendNotification(
  client: lark.Client,
  chatId: string,
  text: string,
): Promise<void> {
  await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    },
  });
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function executeMonthlyCalendarNotify(): Promise<{
  success: boolean;
  message: string;
  eventCount?: number;
}> {
  const chatId = NOTIFY_CHAT_ID;

  const client = createLarkClient();

  // 1. Resolve target user's open_id from chat members
  const openId = await resolveUserOpenId(client, chatId);
  logger.info('monthlyCalendar: target user', { openId } as any);

  // 2. Get valid UAT
  const uat = await getValidAccessToken(openId);
  if (!uat) {
    return {
      success: false,
      message: `No valid access token for open_id=${openId}. Re-authenticate via OAuth.`,
    };
  }

  // 3. Get primary calendar ID
  const calendarId = await fetchPrimaryCalendarId(uat);
  logger.info('monthlyCalendar: primary calendar', { calendarId } as any);

  // 4. Compute month boundaries (JST)
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = jstNow.getUTCFullYear();
  const month = jstNow.getUTCMonth() + 1; // 1-indexed

  // Start of this month in JST → UTC timestamp
  const monthStart = new Date(Date.UTC(year, month - 1, 1, -9, 0, 0)); // JST 00:00
  // Start of next month in JST → UTC timestamp
  const monthEnd = new Date(Date.UTC(year, month, 1, -9, 0, 0)); // next month JST 00:00

  const startTime = String(Math.floor(monthStart.getTime() / 1000));
  const endTime = String(Math.floor(monthEnd.getTime() / 1000));

  logger.info('monthlyCalendar: time range', {
    year,
    month,
    startTime,
    endTime,
  } as any);

  // 5. Fetch all events
  const allEvents = await fetchAllEventsForMonth(uat, calendarId, startTime, endTime);
  logger.info(`monthlyCalendar: fetched ${allEvents.length} raw events`);

  // 6. Filter
  const filtered = filterEvents(allEvents);
  logger.info(`monthlyCalendar: ${filtered.length} events after filtering`);

  // 7. Format
  const text = formatMonthlyNotification(year, month, filtered);

  // 8. Send
  await sendNotification(client, chatId, text);
  logger.info('monthlyCalendar: notification sent', { chatId } as any);

  return {
    success: true,
    message: `Sent ${filtered.length} events for ${year}/${month}`,
    eventCount: filtered.length,
  };
}
