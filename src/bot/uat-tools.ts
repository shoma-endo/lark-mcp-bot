import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { getUATStore, UATRecord } from '../storage/uat-store.js';
import { logger } from '../utils/logger.js';

/** Tools that must run as the requesting user (not the bot app). */
export const UAT_REQUIRED_TOOLS = new Set([
  // MCP calendar tools
  'calendar.v4.calendarEvent.create',
  'calendar.v4.calendarEvent.patch',
  'calendar.v4.calendarEvent.get',
  'calendar.v4.freebusy.list',
  'calendar.v4.calendar.primary',
  // Custom calendar tools
  'calendar.v4.calendarEvent.list',
  // Custom task tools
  'task.v2.task.list',
  // MCP task tools
  'task.v2.task.create',
  'task.v2.task.patch',
  'task.v2.task.addMembers',
  'task.v2.task.addReminders',
]);

export function requiresUAT(toolName: string): boolean {
  return UAT_REQUIRED_TOOLS.has(toolName);
}

/**
 * Retrieve a valid access token for the user.
 * Returns the token string, or null if not available / expired and refresh failed.
 */
export async function getValidAccessToken(openId: string): Promise<string | null> {
  const store = getUATStore();
  const record = await store.getUAT(openId);
  if (!record) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  // Refresh proactively if expiring within 5 minutes
  if (record.expiresAt - 300 < nowSec) {
    return refreshAccessToken(openId, record);
  }
  return record.accessToken;
}

async function refreshAccessToken(openId: string, record: UATRecord): Promise<string | null> {
  try {
    const res = await fetch('https://open.larksuite.com/open-apis/authen/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: config.larkAppId,
        client_secret: config.larkAppSecret,
        refresh_token: record.refreshToken,
      }),
    });
    if (!res.ok) {
      logger.warn(`UAT refresh HTTP error: ${res.status}`);
      return null;
    }
    const data = await res.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      logger.warn('UAT refresh returned no access_token');
      return null;
    }
    const newRecord: UATRecord = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? record.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in ?? 7200),
    };
    await getUATStore().setUAT(openId, newRecord);
    return newRecord.accessToken;
  } catch (err) {
    logger.warn('UAT refresh failed', undefined, err as Error);
    return null;
  }
}

/** Generate and store an OAuth state, then return the full authorization URL. */
export async function buildOAuthUrl(openId: string): Promise<string> {
  const stateId = randomUUID();
  await getUATStore().setOAuthState(stateId, openId);

  const params = new URLSearchParams({
    client_id: config.larkAppId,
    response_type: 'code',
    redirect_uri: config.larkOAuthRedirectUri,
    scope: 'calendar:calendar calendar:calendar:readonly calendar:calendar:update calendar:calendar:create calendar:calendar.event:read task:task:read task:task:write task:tasklist:read task:tasklist:write offline_access',
    state: stateId,
  });
  return `https://open.larksuite.com/open-apis/authen/v1/authorize?${params.toString()}`;
}
