import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adaptDefault } from '@larksuiteoapi/node-sdk';
import { LarkMCPBot } from '../src/bot/index.js';

const bot = new LarkMCPBot();
const adapter = adaptDefault('/webhook/event', bot.getEventDispatcher(), {
  autoChallenge: true,
});

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

  await adapter(req, res);
}
