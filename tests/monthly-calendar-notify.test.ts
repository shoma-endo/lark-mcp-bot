import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub env vars before any imports that pull config
vi.stubEnv('LARK_APP_ID', 'test-app-id');
vi.stubEnv('LARK_APP_SECRET', 'test-app-secret');
vi.stubEnv('GLM_API_KEY', 'test-glm-key');

// Use vi.hoisted to create mocks that can be referenced inside vi.mock factories
const {
  mockConfig,
  mockMessageCreate,
  mockChatMembersGet,
  mockGetValidAccessToken,
} = vi.hoisted(() => ({
  mockConfig: {
    larkAppId: 'test-app-id',
    larkAppSecret: 'test-app-secret',
    larkDomain: 'https://open.larksuite.com',
  },
  mockMessageCreate: vi.fn().mockResolvedValue({ data: {} }),
  mockChatMembersGet: vi.fn().mockResolvedValue({
    data: {
      items: [
        { member_id: 'ou_resolved_user', member_id_type: 'open_id', name: 'Test User' },
      ],
    },
  }),
  mockGetValidAccessToken: vi.fn(),
}));

vi.mock('../src/config.js', () => ({
  config: mockConfig,
  NOTIFY_CHAT_ID: 'oc_testchat',
}));

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: vi.fn().mockImplementation(() => ({
    im: {
      message: { create: mockMessageCreate },
      chatMembers: { get: mockChatMembersGet },
    },
  })),
}));

vi.mock('../src/bot/uat-tools.js', () => ({
  getValidAccessToken: (...args: unknown[]) => mockGetValidAccessToken(...args),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocks
import {
  formatMonthlyNotification,
  executeMonthlyCalendarNotify,
} from '../src/scheduled/monthly-calendar-notify.js';
import type { LarkEvent } from '../src/types/calendar.js';

// ---------------------------------------------------------------------------
// formatMonthlyNotification
// ---------------------------------------------------------------------------

describe('formatMonthlyNotification', () => {
  it('returns empty message when no events', () => {
    const result = formatMonthlyNotification(2026, 4, []);
    expect(result).toContain('2026年4月');
    expect(result).toContain('ありません');
  });

  it('formats events grouped by date', () => {
    const events: LarkEvent[] = [
      {
        summary: 'チームミーティング',
        start_time: { timestamp: String(Date.UTC(2026, 3, 1, 0, 0) / 1000) },
        end_time: { timestamp: String(Date.UTC(2026, 3, 1, 1, 0) / 1000) },
        status: 'confirmed',
      },
      {
        summary: '1on1',
        start_time: { timestamp: String(Date.UTC(2026, 3, 1, 5, 0) / 1000) },
        end_time: { timestamp: String(Date.UTC(2026, 3, 1, 6, 0) / 1000) },
        status: 'confirmed',
      },
      {
        summary: '有給休暇',
        start_time: { date: '2026-04-02' },
        end_time: { date: '2026-04-03' },
        is_all_day: true,
        status: 'confirmed',
      },
    ];

    const result = formatMonthlyNotification(2026, 4, events);
    expect(result).toContain('2026年4月のカレンダー予定（3件）');
    expect(result).toContain('04/01');
    expect(result).toContain('チームミーティング');
    expect(result).toContain('1on1');
    expect(result).toContain('04/02');
    expect(result).toContain('[終日]  有給休暇');
  });

  it('sorts all-day events before timed events', () => {
    const events: LarkEvent[] = [
      {
        summary: '午後会議',
        start_time: { timestamp: String(Date.UTC(2026, 3, 5, 5, 0) / 1000) },
        end_time: { timestamp: String(Date.UTC(2026, 3, 5, 6, 0) / 1000) },
        status: 'confirmed',
      },
      {
        summary: '祝日',
        start_time: { date: '2026-04-05' },
        end_time: { date: '2026-04-06' },
        is_all_day: true,
        status: 'confirmed',
      },
    ];

    const result = formatMonthlyNotification(2026, 4, events);
    const lines = result.split('\n');
    const holidayIdx = lines.findIndex((l) => l.includes('祝日'));
    const meetingIdx = lines.findIndex((l) => l.includes('午後会議'));
    expect(holidayIdx).toBeLessThan(meetingIdx);
  });

  it('handles events without summary', () => {
    const events: LarkEvent[] = [
      {
        start_time: { timestamp: String(Date.UTC(2026, 3, 10, 2, 0) / 1000) },
        end_time: { timestamp: String(Date.UTC(2026, 3, 10, 3, 0) / 1000) },
        status: 'confirmed',
      },
    ];
    const result = formatMonthlyNotification(2026, 4, events);
    expect(result).toContain('（タイトルなし）');
  });
});

// ---------------------------------------------------------------------------
// executeMonthlyCalendarNotify
// ---------------------------------------------------------------------------

/** Standard fetch mocks: calendar list + single-page events */
function mockCalendarAndEvents(events: LarkEvent[]) {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          code: 0,
          data: {
            calendar_list: [
              { calendar: { calendar_id: 'cal_primary', type: 'primary' } },
            ],
          },
        }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          code: 0,
          data: { items: events, has_more: false },
        }),
    });
}

describe('executeMonthlyCalendarNotify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetValidAccessToken.mockReset();
    mockFetch.mockReset();
    mockMessageCreate.mockClear();
    mockChatMembersGet.mockClear();
  });

  it('resolves open_id from chat members when not configured', async () => {
    mockGetValidAccessToken.mockResolvedValue('test-uat-token');
    mockCalendarAndEvents([
      {
        summary: '会議',
        start_time: { timestamp: String(Math.floor(Date.now() / 1000)) },
        end_time: { timestamp: String(Math.floor(Date.now() / 1000) + 3600) },
        status: 'confirmed',
      },
    ]);

    const result = await executeMonthlyCalendarNotify();

    expect(result.success).toBe(true);
    // chatMembers.get was called to resolve the user
    expect(mockChatMembersGet).toHaveBeenCalledOnce();
    // getValidAccessToken was called with the resolved open_id
    expect(mockGetValidAccessToken).toHaveBeenCalledWith('ou_resolved_user');
  });

  it('returns error when no valid UAT', async () => {
    mockGetValidAccessToken.mockResolvedValue(null);

    const result = await executeMonthlyCalendarNotify();

    expect(result.success).toBe(false);
    expect(result.message).toContain('No valid access token');
  });

  it('fetches events and sends notification on success', async () => {
    mockGetValidAccessToken.mockResolvedValue('test-uat-token');

    mockCalendarAndEvents([
      {
        summary: 'テスト会議',
        start_time: { timestamp: String(Math.floor(Date.now() / 1000)) },
        end_time: { timestamp: String(Math.floor(Date.now() / 1000) + 3600) },
        status: 'confirmed',
      },
      {
        summary: 'モビルス定例',
        start_time: { timestamp: String(Math.floor(Date.now() / 1000) + 7200) },
        end_time: { timestamp: String(Math.floor(Date.now() / 1000) + 10800) },
        status: 'confirmed',
      },
    ]);

    const result = await executeMonthlyCalendarNotify();

    expect(result.success).toBe(true);
    expect(result.eventCount).toBe(1); // "モビルス定例" excluded
    expect(mockMessageCreate).toHaveBeenCalledOnce();

    const callArgs = mockMessageCreate.mock.calls[0][0];
    expect(callArgs.params.receive_id_type).toBe('chat_id');
    expect(callArgs.data.receive_id).toBe('oc_testchat');
    expect(callArgs.data.msg_type).toBe('text');

    const content = JSON.parse(callArgs.data.content);
    expect(content.text).toContain('テスト会議');
    expect(content.text).not.toContain('モビルス');
  });

  it('handles pagination when fetching events', async () => {
    mockGetValidAccessToken.mockResolvedValue('test-uat-token');

    mockFetch
      // Calendar list
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            data: {
              calendar_list: [
                { calendar: { calendar_id: 'cal_primary', type: 'primary' } },
              ],
            },
          }),
      })
      // Events page 1
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            data: {
              items: [
                {
                  summary: 'イベントA',
                  start_time: { timestamp: String(Math.floor(Date.now() / 1000)) },
                  end_time: { timestamp: String(Math.floor(Date.now() / 1000) + 3600) },
                  status: 'confirmed',
                },
              ],
              has_more: true,
              page_token: 'token_page2',
            },
          }),
      })
      // Events page 2
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            data: {
              items: [
                {
                  summary: 'イベントB',
                  start_time: { timestamp: String(Math.floor(Date.now() / 1000) + 7200) },
                  end_time: { timestamp: String(Math.floor(Date.now() / 1000) + 10800) },
                  status: 'confirmed',
                },
              ],
              has_more: false,
            },
          }),
      });

    const result = await executeMonthlyCalendarNotify();

    expect(result.success).toBe(true);
    expect(result.eventCount).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('filters out cancelled events', async () => {
    mockGetValidAccessToken.mockResolvedValue('test-uat-token');

    mockCalendarAndEvents([
      {
        summary: '有効な会議',
        start_time: { timestamp: String(Math.floor(Date.now() / 1000)) },
        end_time: { timestamp: String(Math.floor(Date.now() / 1000) + 3600) },
        status: 'confirmed',
      },
      {
        summary: 'キャンセルされた会議',
        start_time: { timestamp: String(Math.floor(Date.now() / 1000) + 7200) },
        end_time: { timestamp: String(Math.floor(Date.now() / 1000) + 10800) },
        status: 'cancelled',
      },
    ]);

    const result = await executeMonthlyCalendarNotify();

    expect(result.success).toBe(true);
    expect(result.eventCount).toBe(1);
  });

  it('filters out all excluded titles', async () => {
    mockGetValidAccessToken.mockResolvedValue('test-uat-token');

    const ts = String(Math.floor(Date.now() / 1000));
    const tsEnd = String(Math.floor(Date.now() / 1000) + 3600);
    mockCalendarAndEvents([
      { summary: '通常会議', status: 'confirmed', start_time: { timestamp: ts }, end_time: { timestamp: tsEnd } },
      { summary: 'EMB勉強会 #5', status: 'confirmed', start_time: { timestamp: ts }, end_time: { timestamp: tsEnd } },
      { summary: '髭剃る', status: 'confirmed', start_time: { timestamp: ts }, end_time: { timestamp: tsEnd } },
      { summary: '爪切る', status: 'confirmed', start_time: { timestamp: ts }, end_time: { timestamp: tsEnd } },
    ]);

    const result = await executeMonthlyCalendarNotify();

    expect(result.success).toBe(true);
    expect(result.eventCount).toBe(1); // Only '通常会議' remains
  });
});
