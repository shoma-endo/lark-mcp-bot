import * as lark from '@larksuiteoapi/node-sdk';
import OpenAI from 'openai';
import { LarkMcpTool } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/mcp-tool.js';
import { larkOapiHandler } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/utils/index.js';
import { config } from '../config.js';
import type {
  ConversationMessage,
  FunctionDefinition,
  MCPTool,
  MCPToolResult,
  LarkMessageEvent,
  LarkTextContent,
  LogContext,
} from '../types.js';
import {
  LLMError,
  ToolExecutionError,
  LarkAPIError,
} from '../types.js';

/**
 * Helper function to send text message via Lark API
 */
async function sendTextMessage(client: lark.Client, chatId: string, text: string): Promise<void> {
  await client.im.message.create({
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

/**
 * Lark MCP AI Agent Bot
 * Main bot logic integrating Lark, MCP, and GLM-4.7
 */
export class LarkMCPBot {
  public larkClient: lark.Client;
  public openai: OpenAI;
  public mcpTool: LarkMcpTool;
  private eventDispatcher: lark.EventDispatcher;

  // Conversation history per chat (with TTL-like cleanup)
  private conversations: Map<string, ConversationMessage[]> = new Map();
  private conversationTimestamps: Map<string, number> = new Map();
  private readonly CONVERSATION_TTL_MS = 60 * 60 * 1000; // 1 hour
  private readonly MAX_CONVERSATIONS = 1000;

  // MCP tools as GLM function definitions
  private functionDefinitions: FunctionDefinition[] = [];

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

    // Initialize Lark MCP Tool (no auth for app-level access)
    this.mcpTool = new LarkMcpTool({
      appId: config.larkAppId,
      appSecret: config.larkAppSecret,
      domain: config.larkDomain,
      toolsOptions: {
        language: 'en',
      },
    }, undefined);

    // Convert MCP tools to GLM function definitions
    this.functionDefinitions = this.convertMcpToolsToFunctions();

    this.eventDispatcher = this.createEventDispatcher();
  }

  /**
   * Convert MCP tools to GLM function calling format
   * Cleans up JSON Schema properties not needed by GLM-4.7
   */
  private convertMcpToolsToFunctions(): FunctionDefinition[] {
    const mcpTools = this.mcpTool.getTools() as MCPTool[];

    return mcpTools.map((tool: MCPTool): FunctionDefinition => {
      // Clean up schema - remove MCP-specific properties
      const { schema } = tool;
      const cleanSchema = {
        type: (schema.type as string) || 'object',
        properties: schema.properties || {},
        required: schema.required || [],
      };

      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: cleanSchema,
        },
      };
    });
  }

  /**
   * Clean up expired conversations to prevent memory leaks
   */
  private cleanupExpiredConversations(): void {
    const now = Date.now();
    const expiredChats: string[] = [];

    for (const [chatId, timestamp] of this.conversationTimestamps) {
      if (now - timestamp > this.CONVERSATION_TTL_MS) {
        expiredChats.push(chatId);
      }
    }

    for (const chatId of expiredChats) {
      this.conversations.delete(chatId);
      this.conversationTimestamps.delete(chatId);
    }

    // Also enforce max conversations limit (LRU-like behavior)
    if (this.conversations.size > this.MAX_CONVERSATIONS) {
      const sortedByTime = [...this.conversationTimestamps.entries()]
        .sort((a, b) => a[1] - b[1]);

      const toRemove = sortedByTime.slice(0, this.conversations.size - this.MAX_CONVERSATIONS);
      for (const [chatId] of toRemove) {
        this.conversations.delete(chatId);
        this.conversationTimestamps.delete(chatId);
      }
    }
  }

  /**
   * Structured logging helper
   */
  private log(level: 'info' | 'warn' | 'error' | 'debug', message: string, context?: LogContext, error?: Error): void {
    const timestamp = new Date().toISOString();
    const logData = {
      timestamp,
      level,
      message,
      ...context,
      ...(error && { error: { name: error.name, message: error.message, stack: error.stack } }),
    };

    if (level === 'error') {
      console.error(JSON.stringify(logData));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(logData));
    } else {
      console.log(JSON.stringify(logData));
    }
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
   * Execute an MCP tool call
   */
  private async executeToolCall(toolName: string, parameters: Record<string, unknown>): Promise<string> {
    const context: LogContext = { toolName };

    try {
      this.log('info', `Executing MCP tool`, {
        ...context,
        parameters: JSON.stringify(parameters).substring(0, 200),
      });

      // Find the tool definition
      const mcpTools = this.mcpTool.getTools() as MCPTool[];
      const tool = mcpTools.find((t: MCPTool) => t.name === toolName);

      if (!tool) {
        throw new ToolExecutionError(`Tool ${toolName} not found`, toolName);
      }

      // Execute using the larkOapiHandler from MCP package
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await larkOapiHandler(this.larkClient, parameters, { tool: tool as any }) as MCPToolResult;

      if (result.isError) {
        throw new ToolExecutionError(
          `Tool execution failed: ${JSON.stringify(result.content)}`,
          toolName
        );
      }

      // Return the result content
      const content = result.content?.[0]?.text || JSON.stringify(result.content);
      this.log('info', `Tool executed successfully`, { ...context, resultLength: content.length });
      return content;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (error instanceof ToolExecutionError) {
        this.log('error', `Tool execution failed`, context, err);
        return `Error: ${err.message}`;
      }

      this.log('error', `Unexpected error during tool execution`, context, err);
      return `Error executing tool: ${err.message}`;
    }
  }

  /**
   * Handle incoming message event with Function Calling
   */
  private async handleMessageReceive(data: LarkMessageEvent): Promise<void> {
    const { message, sender } = data;
    const chatId = message.chat_id || '';
    const userId = sender?.sender_id?.user_id || 'unknown';
    const context: LogContext = { chatId, userId, messageId: message.message_id };

    try {
      // Clean up expired conversations periodically
      this.cleanupExpiredConversations();

      // Parse message content
      let messageText = '';
      if (message.content) {
        try {
          const content: LarkTextContent = JSON.parse(message.content);
          messageText = content.text || '';
        } catch {
          messageText = message.content || '';
        }
      }

      if (!messageText || messageText.trim() === '') {
        return;
      }

      this.log('info', `Received message`, { ...context, messageLength: messageText.length });

      // Get or create conversation history
      if (!this.conversations.has(chatId)) {
        this.conversations.set(chatId, []);
      }
      this.conversationTimestamps.set(chatId, Date.now());
      const history = this.conversations.get(chatId)!;

      // Remove mention from message text
      const cleanText = messageText.replace(/@_user_\d+\s*/g, '');

      // Add user message to history
      history.push({ role: 'user', content: cleanText });

      // Build system prompt with tool descriptions
      const systemPrompt = `あなたはLarkのAIアシスタントボットです。
ユーザーのリクエストに応じてLark APIを通じて様々な操作を実行できます。

利用可能なツール:
${this.functionDefinitions.map(f => `- ${f.function.name}: ${f.function.description}`).join('\n')}

日本語で丁寧に答えてください。ツールを実行する必要がある場合は、適切なツールを選択してください。`;

      // Build messages for GLM
      const messages: ConversationMessage[] = [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...history.slice(-10), // Keep last 10 messages for context
      ];

      // Generate AI response using OpenAI SDK with Function Calling
      const completion = await this.openai.chat.completions.create({
        model: config.glmModel,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: this.functionDefinitions as OpenAI.Chat.ChatCompletionTool[],
        temperature: 0.7,
        max_tokens: 2000,
      });

      const responseMessage = completion.choices[0].message;

      // Check if the model wants to call a function
      const toolCalls = responseMessage.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        // Execute tool calls
        const toolResults: ConversationMessage[] = [];

        for (const toolCall of toolCalls) {
          // Handle both standard and custom tool call formats
          const fnInfo = 'function' in toolCall ? toolCall.function : undefined;
          const functionName = fnInfo?.name || '';
          // GLM-4.7 returns arguments as object, not JSON string
          const rawArgs = fnInfo?.arguments;
          const functionArgs: Record<string, unknown> =
            typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs as unknown as Record<string, unknown>) ?? {};

          // Execute the tool
          const result = await this.executeToolCall(functionName, functionArgs);
          toolResults.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: result,
          });

          // Add assistant message with tool call to history
          history.push({
            role: 'assistant',
            content: responseMessage.content || '',
            tool_calls: toolCalls.map(tc => {
              const fn = 'function' in tc ? tc.function : undefined;
              return {
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: fn?.name || '',
                  arguments: fn?.arguments || '',
                },
              };
            }),
          });

          // Add tool result to history
          history.push(toolResults[toolResults.length - 1]);
        }

        // Get final response after tool execution
        const followUpMessages: ConversationMessage[] = [
          { role: 'system', content: systemPrompt },
          ...history.slice(-20),
        ];

        const followUpCompletion = await this.openai.chat.completions.create({
          model: config.glmModel,
          messages: followUpMessages as OpenAI.Chat.ChatCompletionMessageParam[],
          temperature: 0.7,
          max_tokens: 2000,
        });

        const finalResponse = followUpCompletion.choices[0].message.content || 'すみません、応答を生成できませんでした。';

        // Add final assistant response to history
        history.push({ role: 'assistant', content: finalResponse });

        // Keep only last 30 messages (since we add tool calls)
        if (history.length > 30) {
          history.splice(0, history.length - 30);
        }

        // Send response
        await this.sendMessageWithRetry(chatId, finalResponse, context);

        this.log('info', `Response sent (with tool calls)`, { ...context, responseLength: finalResponse.length });
      } else {
        // No tool calls, just respond
        const responseText = responseMessage.content || 'すみません、応答を生成できませんでした。';

        // Add assistant response to history
        history.push({ role: 'assistant', content: responseText });

        // Keep only last 20 messages
        if (history.length > 20) {
          history.splice(0, history.length - 20);
        }

        // Send response
        await this.sendMessageWithRetry(chatId, responseText, context);

        this.log('info', `Response sent`, { ...context, responseLength: responseText.length });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.log('error', `Error handling message`, context, err);

      // Determine error type and message
      let userErrorMessage = '申し訳ありません。エラーが発生しました。もう一度お試しください。';
      if (error instanceof LLMError) {
        userErrorMessage = '申し訳ありません。AI応答の生成中にエラーが発生しました。しばらくしてからお試しください。';
      } else if (error instanceof ToolExecutionError) {
        userErrorMessage = `申し訳ありません。ツール「${error.toolName}」の実行中にエラーが発生しました。`;
      } else if (error instanceof LarkAPIError) {
        userErrorMessage = '申し訳ありません。Lark APIとの通信中にエラーが発生しました。';
      }

      // Send error message with retry
      try {
        await this.sendMessageWithRetry(chatId, userErrorMessage, context);
      } catch (sendError) {
        const sendErr = sendError instanceof Error ? sendError : new Error(String(sendError));
        this.log('error', `Failed to send error message to user`, context, sendErr);
      }
    }
  }

  /**
   * Send message with retry logic for transient failures
   */
  private async sendMessageWithRetry(
    chatId: string,
    text: string,
    context: LogContext,
    maxRetries: number = 3
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await sendTextMessage(this.larkClient, chatId, text);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.log('warn', `Send message attempt ${attempt} failed`, context, lastError);

        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new LarkAPIError(`Failed to send message after ${maxRetries} attempts`, lastError);
  }

  /**
   * Get the event dispatcher for use with web server
   */
  getEventDispatcher(): lark.EventDispatcher {
    return this.eventDispatcher;
  }
}
