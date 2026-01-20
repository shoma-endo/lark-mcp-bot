import * as lark from '@larksuiteoapi/node-sdk';
import { config } from '../config.js';
import { LarkClient } from '../lark/client.js';
import { GLMClient, ChatMessage } from '../glm/client.js';
import { LarkMCPServer } from '../mcp/server.js';

/**
 * Lark MCP AI Agent Bot
 * Main bot logic integrating Lark, MCP, and GLM-4.7
 */
export class LarkMCPBot {
  public larkClient: LarkClient;
  public glmClient: GLMClient;
  private mcpServer: LarkMCPServer;
  private eventDispatcher: lark.EventDispatcher;

  // Conversation history per chat
  private conversations: Map<string, ChatMessage[]> = new Map();

  constructor() {
    this.larkClient = new LarkClient();
    this.glmClient = new GLMClient();
    this.mcpServer = new LarkMCPServer(this.larkClient);
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

      // Generate AI response
      const responseText = await this.glmClient.generateBotResponse(messageText, {
        chatHistory: history,
        userInfo: { name: sender.sender_id.user_id, userId: sender.sender_id.user_id },
      });

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

  /**
   * Get the MCP server
   */
  getMCPServer(): LarkMCPServer {
    return this.mcpServer;
  }

  /**
   * Start the bot with WebSocket long connection mode
   */
  async startWithWebSocket(): Promise<void> {
    const wsClient = new lark.WSClient({
      appId: config.larkAppId,
      appSecret: config.larkAppSecret,
      domain: config.larkDomain,
      loggerLevel: lark.LoggerLevel.info,
    });

    await wsClient.start({
      eventDispatcher: this.eventDispatcher,
    });

    console.log('Lark MCP Bot started with WebSocket connection');
  }

  /**
   * Process a command with MCP tools
   * This can be used for programmatic tool execution
   */
  async executeMCPTool(toolName: string, args: any): Promise<any> {
    return await this.mcpServer.executeTool(toolName, args);
  }

  /**
   * Get available MCP tools
   */
  getAvailableTools(): any[] {
    return this.mcpServer.getTools();
  }
}
