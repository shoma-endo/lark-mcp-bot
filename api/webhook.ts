import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adaptDefault } from '@larksuiteoapi/node-sdk';

let adapterPromise: Promise<(req: VercelRequest, res: VercelResponse) => Promise<void>> | null = null;
const EVENT_DEDUP_TTL_SECONDS = 600;
const MESSAGE_DEDUP_TTL_SECONDS = 24 * 60 * 60;

function extractDedupIds(body: unknown): { eventId: string | null; messageId: string | null } {
  const payload = body as {
    header?: { event_id?: string; event_type?: string };
    event_id?: string;
    event?: { message?: { message_id?: string } };
  };

  const eventId = payload?.header?.event_id || payload?.event_id || null;
  const messageId = payload?.event?.message?.message_id || null;

  return { eventId, messageId };
}

async function acquireDedupLock(key: string, ttlSeconds: number): Promise<boolean> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  // If Redis is not configured, keep processing rather than blocking webhook flow.
  if (!redisUrl || !redisToken) return true;

  const response = await fetch(redisUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      'SET',
      key,
      '1',
      'EX',
      String(ttlSeconds),
      'NX',
    ]),
  });

  if (!response.ok) {
    throw new Error(`Upstash dedup request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { result?: string | null };
  return data.result === 'OK';
}

async function getAdapter(): Promise<(req: VercelRequest, res: VercelResponse) => Promise<void>> {
  if (!adapterPromise) {
    adapterPromise = (async () => {
      // Vercel runtime uses ephemeral filesystem; force MCP logger state under /tmp.
      process.env.XDG_STATE_HOME = process.env.XDG_STATE_HOME || '/tmp';
      process.env.HOME = process.env.HOME || '/tmp';

      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();
      return adaptDefault('/webhook/event', bot.getEventDispatcher(), {
        autoChallenge: true,
      }) as (req: VercelRequest, res: VercelResponse) => Promise<void>;
    })();
  }

  return adapterPromise;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const deploymentHost = req.headers.host || 'unknown-host';
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || 'unknown-sha';
  const deploymentUrl = process.env.VERCEL_URL || 'unknown-vercel-url';
  console.log('Webhook request context:', { deploymentHost, deploymentUrl, commitSha });

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(200).end();
    return;
  }

  try {
    const { eventId, messageId } = extractDedupIds(req.body);

    if (messageId) {
      const acquiredMessageLock = await acquireDedupLock(
        `dedup:message:${messageId}`,
        MESSAGE_DEDUP_TTL_SECONDS
      );
      if (!acquiredMessageLock) {
        console.log('Skipping duplicate webhook message', { messageId });
        res.status(200).json({ success: true, deduped: true });
        return;
      }
    }

    if (eventId) {
      const acquiredEventLock = await acquireDedupLock(
        `dedup:event:${eventId}`,
        EVENT_DEDUP_TTL_SECONDS
      );
      if (!acquiredEventLock) {
        console.log('Skipping duplicate webhook event', { eventId });
        res.status(200).json({ success: true, deduped: true });
        return;
      }
    }

    const adapter = await getAdapter();
    await adapter(req, res);
  } catch (error) {
    // Reset adapter so the next request can retry clean initialization.
    adapterPromise = null;

    console.error('Webhook adapter error:', {
      deploymentHost,
      deploymentUrl,
      commitSha,
      method: req.method,
      url: req.url,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : String(error),
    });

    if (!res.headersSent) {
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
}
