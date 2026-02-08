import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as lark from '@larksuiteoapi/node-sdk';

// Initialize Lark client
const larkClient = new lark.Client({
  appId: process.env.LARK_APP_ID || '',
  appSecret: process.env.LARK_APP_SECRET || '',
  domain: 'https://open.larksuite.com',
});

/**
 * Vercel Serverless Function for Lark Webhook
 * Process message BEFORE returning response (Vercel kills async after response)
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Immediately return for non-POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // URL verification challenge
  if (req.body?.type === 'url_verification' || req.body?.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }
  
  if (req.body?.header?.event_type === 'url_verification') {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  const eventType = req.body?.header?.event_type || req.body?.type;
  console.log('Event received:', eventType, 'hasEvent:', !!req.body?.event, 'hasMessage:', !!req.body?.event?.message);

  // Handle message events - MUST complete before returning
  if (eventType === 'im.message.receive_v1') {
    const message = req.body.event?.message;
    const chatId = message?.chat_id;
    const messageType = message?.message_type;
    const sender = req.body.event?.sender;

    // Skip if bot sent the message
    if (sender?.sender_type === 'app') {
      console.log('Skip: message from bot itself');
      return res.status(200).json({ success: true });
    }

    console.log('Message received:', { chatId, messageType, senderType: sender?.sender_type });

    if (messageType === 'text' && chatId) {
      let messageText = '';
      try {
        const content = typeof message.content === 'string' ? JSON.parse(message.content) : message.content;
        messageText = content?.text ?? message.content ?? '';
      } catch {
        messageText = String(message.content ?? '');
      }

      console.log('Message text:', messageText.substring(0, 100));

      try {
        const replyText = `受信しました: ${messageText}`;
        await larkClient.im.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            content: JSON.stringify({ text: replyText }),
            msg_type: 'text',
          },
        });
        console.log('Reply sent successfully to', chatId);
      } catch (err) {
        console.error('Send message error:', err instanceof Error ? err.message : err);
      }
    } else {
      console.log('Skip: not text message or no chatId', { messageType, chatId });
    }
  } else {
    console.log('Skip: not im.message.receive_v1', { eventType });
  }

  // Return 200 only after processing
  return res.status(200).json({ success: true });
}
