/**
 * Vercel Serverless Function for Lark Webhook
 * Responds immediately to avoid timeout, then processes message asynchronously
 */

import { Client } from '@larksuiteoapi/node-sdk';

// Hardcoded config
const LARK_APP_ID = 'cli_a8dd15cc74f8d02d';
const LARK_APP_SECRET = 'Vmntc3dthwWdeN0HPY4dxdTQiBIQw6he';
const LARK_DOMAIN = 'https://open.feishu.cn';
const GLM_API_KEY = 'dc07276f30214ac7849d5fe2c75b7652.rrmQUhYwpyQh5LwR';
const GLM_API_BASE_URL = 'https://api.z.ai/api/paas/v4';
const GLM_MODEL = 'glm-4.7';

// Lark client for sending messages
const larkClient = new Client({
  appId: LARK_APP_ID,
  appSecret: LARK_APP_SECRET,
  domain: LARK_DOMAIN,
});

// Process message asynchronously
async function processMessageAsync(messageData: any) {
  try {
    const message = messageData.message;
    const sender = messageData.sender;

    if (!message || !sender) {
      console.log('No message or sender in event data');
      console.log('Event data:', JSON.stringify(messageData));
      return;
    }

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
      console.log('Empty message text');
      return;
    }

    console.log(`Processing message from ${sender.sender_id.user_id}: ${messageText}`);

    // Get GLM response
    const glmResponse = await fetch(`${GLM_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: GLM_MODEL,
        messages: [
          {
            role: 'system',
            content: 'あなたはLarkのAIアシスタントボットです。日本語で丁寧に答えてください。',
          },
          {
            role: 'user',
            content: messageText,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    const glmData = await glmResponse.json();
    const responseText = glmData.choices?.[0]?.message?.content || 'すみません、応答を生成できませんでした。';

    console.log(`GLM response: ${responseText.substring(0, 50)}...`);

    // Send reply to Lark
    await larkClient.im.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data: {
        receive_id: message.chat_id,
        content: JSON.stringify({ text: responseText }),
        msg_type: 'text',
      },
    });

    console.log('Reply sent successfully');
  } catch (error) {
    console.error('Error processing message:', error);
  }
}

export default async function handler(req: any, res: any) {
  // Log incoming request for debugging
  console.log('Webhook received:', req.method, req.url);

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
    console.log('Request body type:', body ? typeof body : 'empty');
    console.log('Request body keys:', body ? Object.keys(body) : 'none');

    // Handle challenge verification (Lark's handshake)
    if (body?.challenge) {
      console.log('Handling challenge');
      res.json({ challenge: body.challenge });
      return;
    }

    // Log event structure
    if (body?.event) {
      console.log('Event received:', JSON.stringify(body.event).substring(0, 200));
    } else if (body?.header) {
      // Lark might send events in a different format
      console.log('Event with header received');
      console.log('Event type:', body.header.event_name);
      console.log('Event data:', JSON.stringify(body.event).substring(0, 200));
    } else {
      console.log('Unknown body structure:', JSON.stringify(body).substring(0, 200));
    }

    // Immediately respond with 200 OK to avoid timeout
    res.status(200).json({ code: 0, msg: 'success' });

    // Process message asynchronously after responding
    if (body?.event) {
      Promise.resolve().then(() => processMessageAsync(body.event));
    } else if (body?.header && body?.event) {
      // Handle Lark's event format with header
      Promise.resolve().then(() => processMessageAsync(body.event));
    }
  } catch (error) {
    console.error('Webhook error:', error);
    if (!res.headersSent) {
      res.status(200).json({ code: 0, msg: 'received' }); // Still return 200 to avoid Lark retry
    }
  }
}
