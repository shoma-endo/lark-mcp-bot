/**
 * Lark MCP AI Agent Bot - Local Server
 * Runs locally with Cloudflare Tunnel for public URL
 */

import { createServer } from 'http';
import { LarkMCPBot } from './bot/index.js';
import { adaptDefault } from '@larksuiteoapi/node-sdk';
import { config } from './config.js';

const PORT = config.port;

async function main() {
  console.log('🚀 Starting Lark MCP Bot (Local Server)...');
  console.log(`   Lark App ID: ${config.larkAppId}`);
  console.log(`   GLM Model: ${config.glmModel}`);

  // Create bot instance
  const bot = new LarkMCPBot();

  // Create HTTP server
  const server = createServer();

  // Handle webhook requests
  const adapter = adaptDefault('/webhook/event', bot.getEventDispatcher(), {
    autoChallenge: true,
  });

  server.on('request', async (req, res) => {
    // CORS
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(200);
      res.end();
      return;
    }

    // Health check
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        bot: 'Lark MCP AI Agent Bot',
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    // Webhook endpoint
    if (req.url?.startsWith('/webhook')) {
      await adapter(req, res);
      return;
    }

    // 404 for other routes
    res.writeHead(404);
    res.end('Not Found');
  });

  // Start server
  server.listen(PORT, () => {
    console.log(`\n✅ Lark MCP Bot is running!`);
    console.log(`📡 Webhook: http://localhost:${PORT}/webhook/event`);
    console.log(`\n🌐 Next step: Create Cloudflare Tunnel`);
    console.log(`   npx cloudflared tunnel --url http://localhost:${PORT}\n`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down gracefully...');
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down gracefully...');
    server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
