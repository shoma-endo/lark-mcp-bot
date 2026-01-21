/**
 * Vercel Serverless Function for Lark Webhook
 * Uses background execution to avoid timeout
 */

import { Client } from '@larksuiteoapi/node-sdk';

// Hardcoded config
const LARK_APP_ID = 'cli_a8dd15cc74f8d02d';
const LARK_APP_SECRET = 'Vmntc3dthwWdeN0HPY4dxdTQiBIQw6he';
const LARK_DOMAIN = 'https://open.feishu.cn';
const GLM_API_KEY = 'dc07276f30214ac7849d5fe2c75b7652.rrmQUhYwpyQh5LwR';
const GLM_API_BASE_URL = 'https://api.z.ai/api/paas/v4';
const GLM_MODEL = 'glm-4.7';

// Lark client
const larkClient = new Client({
  appId: LARK_APP_ID,
  appSecret: LARK_APP_SECRET,
  domain: LARK_DOMAIN,
});

// Function to get GLM response
async function getGLMResponse(messageText: string): Promise<string> {
  const response = await fetch(`${GLM_API_BASE_URL}/chat/completions`, {
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
          content: 'あなたはLarkのAIアシスタントボットです。日本語で丁寧に答えてください。ユーザーがメンションで話しかけたら、メンションを外して通常のテキストで答えてください。',
        },
        {
          role: 'user',
          content: messageText.replace(/@_user_\d+\s*/g, ''), // Remove mention
        },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    }),
  });

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || 'すみません、応答を生成できませんでした。';
}

// Function to send message to Lark
async function sendLarkMessage(chatId: string, text: string): Promise<void> {
  await larkClient.im.message.create({
    params: {
      receive_id_type: 'chat_id',
    },
    data: {
      receive_id: chatId,
      content: JSON.stringify({ text }),
      msg_type: 'text',
    },
  });
}

export default async function handler(req: any, res: any) {
  console.log('Webhook received:', req.method, req.url);

  // Handle CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = req.body;
    console.log('Request keys:', Object.keys(body));

    // Handle challenge
    if (body?.challenge) {
      console.log('Challenge received');
      res.json({ challenge: body.challenge });
      return;
    }

    // Parse event - Lark sends { schema, header, event }
    const event = body?.event;
    if (!event) {
      console.log('No event in body');
      res.status(200).json({ code: 0, msg: 'success' });
      return;
    }

    const message = event.message;
    const sender = event.sender;

    console.log('Message data:', JSON.stringify({ message, sender }).substring(0, 200));

    // Respond immediately to avoid timeout
    res.status(200).json({ code: 0, msg: 'success' });

    // Process in background after response
    if (message && sender) {
      // Parse message text
      let messageText = '';
      if (message.content) {
        try {
          const content = JSON.parse(message.content);
          messageText = content.text || '';
        } catch {
          messageText = message.content || '';
        }
      }

      if (messageText && messageText.trim()) {
        const chatId = message.chat_id;

        // Process with immediate feedback to user
        (async () => {
          try {
            console.log('Getting GLM response for:', messageText);
            const responseText = await getGLMResponse(messageText);
            console.log('GLM response received, sending to Lark...');
            await sendLarkMessage(chatId, responseText);
            console.log('Reply sent successfully!');
          } catch (error: any) {
            console.error('Error in background processing:', error?.message || error);
            // Try to send error message
            try {
              await sendLarkMessage(chatId, '申し訳ありません。エラーが発生しました。');
            } catch {
              console.log('Failed to send error message');
            }
          }
        })();
      }
    }
  } catch (error) {
    console.error('Webhook error:', error);
    if (!res.headersSent) {
      res.status(200).json({ code: 0, msg: 'received' });
    }
  }
}
