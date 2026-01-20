/**
 * Lark MCP AI Agent Bot
 * Main entry point for the bot - Vercel serverless function
 */

import { LarkMCPBot } from './bot/index.js';
import { adaptDefault } from '@larksuiteoapi/node-sdk';
import { config } from './config.js';

// Singleton bot instance
let botInstance: LarkMCPBot | null = null;

/**
 * Get or create bot instance
 */
function getBot(): LarkMCPBot {
  if (!botInstance) {
    console.log('Creating Lark MCP Bot instance...');
    botInstance = new LarkMCPBot();
  }
  return botInstance;
}

/**
 * Vercel serverless function handler
 */
export default async function handler(req: any, res: any) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(200).end();
    return;
  }

  const bot = getBot();
  const dispatcher = bot.getEventDispatcher();

  // Use Lark SDK's adapter to handle the request
  const adapter = adaptDefault('/webhook/event', dispatcher, {
    autoChallenge: true,
  });

  // The adapter returns a middleware function
  await adapter(req, res);
}

/**
 * Health check endpoint
 */
export async function healthCheck(req: any, res: any) {
  res.status(200).json({
    status: 'ok',
    bot: 'Lark MCP AI Agent Bot',
    timestamp: new Date().toISOString(),
  });
}
