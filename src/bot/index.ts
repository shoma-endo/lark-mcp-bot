import * as lark from '@larksuiteoapi/node-sdk';
import OpenAI from 'openai';
import { config } from '../config.js';

/**
 * Lark MCP AI Agent Bot
 * Main bot logic integrating Lark, MCP, and GLM-4.7
 */
export class LarkMCPBot {
  public larkClient: lark.Client;
  public openai: OpenAI;
  private mcpServer: any;
  private eventDispatcher: lark.EventDispatcher;

  // Conversation history per chat
  private conversations: Map<string, any[]> = new Map();

  constructor() {
    this.larkClient = new lark.Client({
      appId: config.larkAppId,
      appSecret: config.larkAppSecret,
      domain: config.larkDomain,
    });

    // Initialize OpenAI client with GLM-4.7
    this.openai = new OpenAI({
      apiKey: config.glmApiKey,
      baseURL: config.glmApiBaseUrl,
    });

    // Note: MCP server would be initialized here if needed
    this.eventDispatcher = this.createEventDispatcher();
  }

  /**
   * Create event dispatcher for Lark events
   */
  private createEventDispatcher(): lark.EventDispatcher {
    const dispatcher = new lark.EventDispatcher({
      encryptKey: process.env.LARK_ENCRYPT_KEY,
      loggerLevel: lark.LoggerLevel.info,
    });

    // Register message received handler
    dispatcher.register({
      'im.message.receive_v1': this.handleMessageReceive.bind(this),
    });

    return dispatcher;
  }

  /**
   * Handle incoming message event
   */
  private async handleMessageReceive(data: any): Promise<void> {
    const { message, sender } = data;

    try {
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

      console.log(`[${sender.sender_id.user_id}]: ${messageText}`);

      // Get or create conversation history
      const chatId = message.chat_id;
      if (!this.conversations.has(chatId)) {
        this.conversations.set(chatId, []);
      }
      const history = this.conversations.get(chatId)!;

      // Add user message to history
      history.push({ role: 'user', content: messageText });

      // Remove mention from message text
      const cleanText = messageText.replace(/@_user_\d+\s*/g, '');

      // Build messages for GLM
      const messages: any[] = [
        {
          role: 'system',
          content: 'あなたはLarkのAIアシスタントボットです。日本語で丁寧に答えてください。',
        },
        ...history.slice(-10), // Keep last 10 messages for context
      ];

      // Generate AI response using OpenAI SDK
      const completion = await this.openai.chat.completions.create({
        model: config.glmModel,
        messages,
        temperature: 0.7,
        max_tokens: 1000,
      });

      const responseText = completion.choices[0].message.content || 'すみません、応答を生成できませんでした。';

      // Add assistant response to history
      history.push({ role: 'assistant', content: responseText });

      // Keep only last 20 messages
      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }

      // Send response
      await this.larkClient.sendTextMessage(chatId, responseText);

      console.log(`[Bot]: ${responseText.substring(0, 100)}...`);
    } catch (error) {
      console.error('Error handling message:', error);

      // Send error message
      try {
        await this.larkClient.sendTextMessage(
          message.chat_id,
          '申し訳ありません。エラーが発生しました。もう一度お試しください。'
        );
      } catch {
        // Ignore send error
      }
    }
  }

  /**
   * Get the event dispatcher for use with web server
   */
  getEventDispatcher(): lark.EventDispatcher {
    return this.eventDispatcher;
  }
}
