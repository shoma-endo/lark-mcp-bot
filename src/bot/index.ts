import * as lark from '@larksuiteoapi/node-sdk';
import OpenAI from 'openai';
import { LarkMcpTool } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/mcp-tool.js';
import { larkOapiHandler } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/utils/index.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { createStorage, type ConversationStorage } from '../storage/index.js';
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
  APIRateLimitError,
  ResourcePackageError,
  ValidationError,
  LarkBotError,
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
  private storage: ConversationStorage;

  // Conversation TTL settings
  private readonly CONVERSATION_TTL_MS = 60 * 60 * 1000; // 1 hour
  private readonly MESSAGE_DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // MCP tools as GLM function definitions
  private functionDefinitions: FunctionDefinition[] = [];
  private processedMessageIds: Map<string, number> = new Map();

  /**
   * Extract detailed OpenAI-compatible API error fields for diagnostics.
   */
  private getApiErrorDetails(error: unknown): Record<string, unknown> {
    const apiError = error as {
      status?: number;
      code?: string | number;
      type?: string;
      param?: string;
      request_id?: string;
      headers?: Record<string, string>;
      error?: {
        code?: string | number;
        message?: string;
        type?: string;
        param?: string;
      };
    };

    return {
      status: apiError?.status,
      code: apiError?.code,
      type: apiError?.type,
      param: apiError?.param,
      requestId: apiError?.request_id,
      responseErrorCode: apiError?.error?.code,
      responseErrorType: apiError?.error?.type,
      responseErrorParam: apiError?.error?.param,
      responseErrorMessage: apiError?.error?.message,
      xRequestId: apiError?.headers?.['x-request-id'],
    };
  }

  /**
   * Extract business error code from OpenAI-compatible API error object.
   */
  private getApiBusinessErrorCode(error: unknown): string | undefined {
    const apiError = error as {
      code?: string | number;
      error?: {
        code?: string | number;
      };
    };

    const nestedCode = apiError?.error?.code;
    const topLevelCode = apiError?.code;
    const code = nestedCode ?? topLevelCode;
    return code === undefined || code === null ? undefined : String(code);
  }

  /**
   * Map GLM API business error code into user-facing error class.
   */
  private mapApiErrorToBotError(error: unknown, fallbackError: Error): LarkBotError | null {
    const businessCode = this.getApiBusinessErrorCode(error);

    // Billing/package-related limitations
    if (businessCode === '1113' || businessCode === '1308' || businessCode === '1309') {
      return new ResourcePackageError(`GLM API billing/resource error (${businessCode})`, fallbackError);
    }

    // API frequency/concurrency limits
    if (businessCode === '1302' || businessCode === '1303' || businessCode === '1305') {
      return new APIRateLimitError(`GLM API throttled (${businessCode})`, fallbackError);
    }

    return null;
  }

  /**
   * Check and mark message ID to avoid duplicate replies when webhook events are retried.
   */
  private shouldProcessMessage(messageId?: string): boolean {
    if (!messageId) return true;

    const now = Date.now();

    // Clean up expired dedup entries
    for (const [id, ts] of this.processedMessageIds.entries()) {
      if (now - ts > this.MESSAGE_DEDUP_TTL_MS) {
        this.processedMessageIds.delete(id);
      }
    }

    const previous = this.processedMessageIds.get(messageId);
    if (previous && now - previous <= this.MESSAGE_DEDUP_TTL_MS) {
      return false;
    }

    this.processedMessageIds.set(messageId, now);
    return true;
  }

  constructor(storage?: ConversationStorage) {
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

    // Initialize storage (Redis in production, Memory in development)
    this.storage = storage || createStorage();

    // Convert MCP tools to GLM function definitions
    this.functionDefinitions = this.convertMcpToolsToFunctions();

    this.eventDispatcher = this.createEventDispatcher();
  }

  /**
   * Filter MCP tools based on configuration
   */
  private filterMcpTools(tools: MCPTool[]): MCPTool[] {
    const { enabledToolPrefixes, disabledTools } = config;
    
    let filtered = tools;

    // Filter by enabled prefixes (if specified)
    if (enabledToolPrefixes.length > 0) {
      filtered = filtered.filter((tool) =>
        enabledToolPrefixes.some((prefix) => tool.name.startsWith(prefix))
      );
    }

    // Remove explicitly disabled tools
    if (disabledTools.length > 0) {
      filtered = filtered.filter((tool) => !disabledTools.includes(tool.name));
    }

    logger.info(`MCP tools filtered`, undefined, {
      totalTools: tools.length,
      filteredTools: filtered.length,
      enabledPrefixes: enabledToolPrefixes,
      disabledTools: disabledTools,
    });

    return filtered;
  }

  /**
   * Convert MCP tools to GLM function calling format
   * Cleans up JSON Schema properties not needed by GLM-4.7
   */
  private convertMcpToolsToFunctions(): FunctionDefinition[] {
    const allMcpTools = this.mcpTool.getTools() as MCPTool[];
    const mcpTools = this.filterMcpTools(allMcpTools);

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
   * Clean up expired conversations to prevent memory/storage bloat
   */
  private async cleanupExpiredConversations(): Promise<void> {
    const cleaned = await this.storage.cleanup(this.CONVERSATION_TTL_MS);

    if (cleaned > 0) {
      logger.debug(`Cleaned up expired conversations`, undefined, {
        cleanedCount: cleaned,
      });
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
   * Execute an MCP tool call with enhanced error handling and logging
   */
  private async executeToolCall(toolName: string, parameters: Record<string, unknown>): Promise<string> {
    const context: LogContext = { toolName };
    const metricId = `tool_${toolName}_${Date.now()}`;

    try {
      logger.startMetric(metricId, `execute_tool_${toolName}`, { parameters });
      logger.info(`Executing MCP tool`, context, {
        parametersPreview: JSON.stringify(parameters).substring(0, 200),
      });

      // Validate tool name
      if (!toolName || typeof toolName !== 'string') {
        throw new ValidationError('Invalid tool name', 'toolName');
      }

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
        const errorContent = result.content?.[0]?.text || JSON.stringify(result.content);
        throw new ToolExecutionError(
          `Tool execution failed: ${errorContent}`,
          toolName
        );
      }

      // Return the result content
      const content = result.content?.[0]?.text || JSON.stringify(result.content);
      
      logger.endMetric(metricId, context, { resultLength: content.length });
      logger.info(`Tool executed successfully`, context, { resultLength: content.length });
      
      return content;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      logger.endMetric(metricId, context, { success: false, error: err.message });

      if (error instanceof ToolExecutionError) {
        logger.error(`Tool execution failed`, context, err);
        return `Error: ${err.message}`;
      }

      if (error instanceof ValidationError) {
        logger.warn(`Tool validation failed`, context, err);
        return `Error: ${err.message}`;
      }

      // Wrap unknown errors
      logger.error(`Unexpected error during tool execution`, context, err);
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
    const metricId = `handle_message_${chatId}_${Date.now()}`;

    try {
      logger.startMetric(metricId, 'handle_message_receive', { chatId, userId });

      if (!this.shouldProcessMessage(message.message_id)) {
        logger.info('Skipping duplicate message event', context);
        return;
      }
      
      // Clean up expired conversations periodically
      await this.cleanupExpiredConversations();

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
        logger.debug(`Skipping empty message`, context);
        return;
      }

      logger.info(`Received message`, context, { messageLength: messageText.length });

      // Get or create conversation history from storage
      const history = await this.storage.getHistory(chatId);
      await this.storage.setTimestamp(chatId, Date.now());

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
      const llmMetricId = `llm_completion_${chatId}_${Date.now()}`;
      logger.startMetric(llmMetricId, 'llm_completion', { 
        model: config.glmModel,
        messageCount: messages.length,
      });
      
      let completion;
      try {
        completion = await this.openai.chat.completions.create({
          model: config.glmModel,
          messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
          tools: this.functionDefinitions as OpenAI.Chat.ChatCompletionTool[],
          temperature: 0.7,
          max_tokens: 2000,
        });
        
        logger.endMetric(llmMetricId, context, { 
          success: true,
          tokensUsed: completion.usage?.total_tokens,
        });
      } catch (error) {
        logger.endMetric(llmMetricId, context, { success: false });
        
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('GLM completion request failed', context, err, this.getApiErrorDetails(error));
        const mappedError = this.mapApiErrorToBotError(error, err);
        if (mappedError) {
          throw mappedError;
        }
        
        // Check for rate limit errors
        if (err.message.includes('429') || err.message.toLowerCase().includes('rate limit')) {
          throw new APIRateLimitError('GLM API rate limit exceeded', err);
        }
        
        // Wrap as LLM error
        throw new LLMError(`Failed to generate AI response: ${err.message}`, err);
      }

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

        const followUpMetricId = `llm_followup_${chatId}_${Date.now()}`;
        logger.startMetric(followUpMetricId, 'llm_followup_completion', {
          model: config.glmModel,
          messageCount: followUpMessages.length,
        });

        let followUpCompletion;
        try {
          followUpCompletion = await this.openai.chat.completions.create({
            model: config.glmModel,
            messages: followUpMessages as OpenAI.Chat.ChatCompletionMessageParam[],
            temperature: 0.7,
            max_tokens: 2000,
          });
          
          logger.endMetric(followUpMetricId, context, {
            success: true,
            tokensUsed: followUpCompletion.usage?.total_tokens,
          });
        } catch (error) {
          logger.endMetric(followUpMetricId, context, { success: false });
          
          const err = error instanceof Error ? error : new Error(String(error));
          logger.error('GLM follow-up completion request failed', context, err, this.getApiErrorDetails(error));
          const mappedError = this.mapApiErrorToBotError(error, err);
          if (mappedError) {
            throw mappedError;
          }
          
          if (err.message.includes('429') || err.message.toLowerCase().includes('rate limit')) {
            throw new APIRateLimitError('GLM API rate limit exceeded', err);
          }
          
          throw new LLMError(`Failed to generate follow-up response: ${err.message}`, err);
        }

        const finalResponse = followUpCompletion.choices[0].message.content || 'すみません、応答を生成できませんでした。';

        // Add final assistant response to history
        history.push({ role: 'assistant', content: finalResponse });

        // Keep only last 30 messages (since we add tool calls)
        if (history.length > 30) {
          history.splice(0, history.length - 30);
        }

        // Save conversation history to storage
        await this.storage.setHistory(chatId, history);

        // Send response
        await this.sendMessageWithRetry(chatId, finalResponse, context);

        logger.endMetric(metricId, context, { 
          withToolCalls: true,
          toolCallCount: toolCalls.length,
          responseLength: finalResponse.length,
        });
        logger.info(`Response sent (with tool calls)`, context, { responseLength: finalResponse.length });
      } else {
        // No tool calls, just respond
        const responseText = responseMessage.content || 'すみません、応答を生成できませんでした。';

        // Add assistant response to history
        history.push({ role: 'assistant', content: responseText });

        // Keep only last 20 messages
        if (history.length > 20) {
          history.splice(0, history.length - 20);
        }

        // Save conversation history to storage
        await this.storage.setHistory(chatId, history);

        // Send response
        await this.sendMessageWithRetry(chatId, responseText, context);

        logger.endMetric(metricId, context, { 
          withToolCalls: false,
          responseLength: responseText.length,
        });
        logger.info(`Response sent`, context, { responseLength: responseText.length });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      
      logger.endMetric(metricId, context, { 
        success: false,
        error: err.message,
      });
      logger.error(`Error handling message`, context, err);

      // Determine error type and message using custom error classes
      let userErrorMessage: string;
      
      if (error instanceof LarkBotError) {
        // Use the custom error's user-friendly message
        userErrorMessage = error.toUserMessage();
      } else if (error instanceof Error && error.message.includes('rate limit')) {
        // Handle rate limit errors from external APIs
        userErrorMessage = '申し訳ありません。現在リクエストが集中しています。しばらく待ってからお試しください。';
      } else {
        // Generic error message for unknown errors
        userErrorMessage = '申し訳ありません。エラーが発生しました。もう一度お試しください。';
      }

      // Send error message with retry
      try {
        await this.sendMessageWithRetry(chatId, userErrorMessage, context);
      } catch (sendError) {
        const sendErr = sendError instanceof Error ? sendError : new Error(String(sendError));
        logger.error(`Failed to send error message to user`, context, sendErr);
      }
    }
  }

  /**
   * Send message with retry logic and exponential backoff for transient failures
   */
  private async sendMessageWithRetry(
    chatId: string,
    text: string,
    context: LogContext,
    maxRetries: number = 3
  ): Promise<void> {
    const metricId = `send_message_${chatId}_${Date.now()}`;
    let lastError: Error | undefined;

    logger.startMetric(metricId, 'send_message', { chatId, textLength: text.length });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await sendTextMessage(this.larkClient, chatId, text);
        
        logger.endMetric(metricId, context, { 
          attempts: attempt,
          success: true,
        });
        
        if (attempt > 1) {
          logger.info(`Message sent after retry`, context, { attempts: attempt });
        }
        
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        logger.warn(`Send message attempt ${attempt} failed`, context, lastError, {
          attempt,
          maxRetries,
        });

        // Check if error is retryable
        const isRetryable = this.isRetryableError(lastError);
        
        if (!isRetryable || attempt >= maxRetries) {
          logger.endMetric(metricId, context, {
            attempts: attempt,
            success: false,
            error: lastError.message,
          });
          break;
        }

        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          logger.debug(`Retrying after ${delay}ms`, context, { delay, attempt });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new LarkAPIError(`Failed to send message after ${maxRetries} attempts`, lastError);
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // Network errors, timeouts, and 5xx errors are retryable
    if (message.includes('timeout') || 
        message.includes('econnreset') ||
        message.includes('enotfound') ||
        message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504')) {
      return true;
    }
    
    // 4xx errors (except 429 rate limit) are not retryable
    if (message.includes('400') ||
        message.includes('401') ||
        message.includes('403') ||
        message.includes('404')) {
      return false;
    }
    
    // Rate limit errors are retryable
    if (message.includes('429') || message.includes('rate limit')) {
      return true;
    }
    
    // Default: retry for unknown errors
    return true;
  }

  /**
   * Get the event dispatcher for use with web server
   */
  getEventDispatcher(): lark.EventDispatcher {
    return this.eventDispatcher;
  }

  /**
   * Get storage instance (for testing)
   */
  getStorage(): ConversationStorage {
    return this.storage;
  }
}
