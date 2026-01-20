/**
 * Vercel Serverless Function for Lark Webhook
 * Responds immediately to avoid timeout, then processes message asynchronously
 */

import { LarkMCPBot } from '../dist/bot/index.js';

// Singleton bot instance
let botInstance: LarkMCPBot | null = null;

function getBot(): LarkMCPBot {
  if (!botInstance) {
    console.log('Creating Lark MCP Bot instance...');
    botInstance = new LarkMCPBot();
  }
  return botInstance;
}

// Process message asynchronously (doesn't block response)
async function processMessageAsync(messageData: any) {
  try {
    const { message, sender } = messageData;

    // Parse message content
    let messageText = '';
    if (message.content) {
      try {
        const content = JSON.parse(message.content);
        messageText = content.text || '';
      } catch {
        messageText = message.content || '';
      }
    }

    if (!messageText || messageText.trim() === '') {
      return;
    }

    console.log(`Processing message from ${sender.sender_id.user_id}: ${messageText}`);

    // Get GLM response
    const responseText = await getBot().glmClient.generateBotResponse(messageText, {
      chatHistory: [{ role: 'user', content: messageText }],
      userInfo: { name: sender.sender_id.user_id, userId: sender.sender_id.user_id },
    });

    // Send reply to Lark
    await getBot().larkClient.sendTextMessage(message.chat_id, responseText);

    console.log(`Reply sent: ${responseText.substring(0, 50)}...`);
  } catch (error) {
    console.error('Error processing message:', error);
  }
}

export default async function handler(req: any, res: any) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(200).end();
    return;
  }

  // Only allow POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = req.body;

    // Handle challenge verification (Lark's handshake)
    if (body?.challenge) {
      res.json({ challenge: body.challenge });
      return;
    }

    // Immediately respond with 200 OK to avoid timeout
    res.status(200).json({ code: 0, msg: 'success' });

    // Process message asynchronously after responding
    if (body?.event) {
      // Use setImmediate or Promise.resolve() to process after response
      Promise.resolve().then(() => processMessageAsync(body.event));
    }
  } catch (error) {
    console.error('Webhook error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
