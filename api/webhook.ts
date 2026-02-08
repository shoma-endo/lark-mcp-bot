import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adaptDefault } from '@larksuiteoapi/node-sdk';

let adapterPromise: Promise<(req: VercelRequest, res: VercelResponse) => Promise<void>> | null = null;

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
    const adapter = await getAdapter();
    await adapter(req, res);
  } catch (error) {
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
