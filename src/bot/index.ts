import * as lark from '@larksuiteoapi/node-sdk';
import { LarkMcpTool } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/mcp-tool.js';
import { defaultToolNames, presetCalendarToolNames, presetTaskToolNames } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/constants.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { createStorage, type ConversationStorage } from '../storage/index.js';
import type {
  LarkMessageEvent,
  LogContext,
} from '../types.js';
import {
  LarkAPIError,
} from '../types.js';
import { LLMService } from './llm-service.js';
import { ToolExecutor } from './tool-executor.js';
import { MessageProcessor } from './message-processor.js';

/**
 * Helper function to send reply message via Lark API
 */
async function sendReplyMessage(
  client: lark.Client,
  messageId: string,
  text: string,
  uuid?: string,
  replyInThread = false
): Promise<void> {
  await client.im.message.reply({
    path: {
      message_id: messageId,
    },
    data: {
      content: JSON.stringify({ text }),
      msg_type: 'text',
      uuid,
      ...(replyInThread ? { reply_in_thread: true } : {}),
    },
  });
}

/**
 * Lark MCP AI Agent Bot
 * Main bot logic integrating Lark, MCP, and GLM-4.7
 */
export class LarkMCPBot {
  public larkClient: lark.Client;
  public mcpTool: LarkMcpTool;
  private eventDispatcher: lark.EventDispatcher;
  private storage: ConversationStorage;
  private llmService: LLMService;
  private toolExecutor: ToolExecutor;
  private messageProcessor: MessageProcessor;

  // TTL settings
  private readonly MESSAGE_DEDUP_TTL_MS = 24 * 60 * 60 * 1000;
  private readonly MESSAGE_DEDUP_TTL_SECONDS = 24 * 60 * 60;
  private readonly CONVERSATION_TTL_MS = 60 * 60 * 1000;
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes max between cleanups
  private lastCleanupTime: number = Date.now();

  private processedMessageIds: Map<string, number> = new Map();
  private pendingPromises: Set<Promise<any>> = new Set();

  constructor(storage?: ConversationStorage) {
    this.larkClient = new lark.Client({
      appId: config.larkAppId,
      appSecret: config.larkAppSecret,
      domain: config.larkDomain,
    });

    this.mcpTool = new LarkMcpTool({
      appId: config.larkAppId,
      appSecret: config.larkAppSecret,
      domain: config.larkDomain,
      toolsOptions: {
        language: 'en',
        allowTools: [...new Set([
          ...defaultToolNames,
          ...presetCalendarToolNames,
          ...presetTaskToolNames,
          'bitable.v1.appTableField.create',
        ])] as any,
      },
    }, undefined);

    this.storage = storage || createStorage();
    this.llmService = new LLMService();
    this.toolExecutor = new ToolExecutor(this.larkClient, this.mcpTool);
    this.messageProcessor = new MessageProcessor(this.llmService, this.toolExecutor, this.storage);
    this.eventDispatcher = this.createEventDispatcher();
  }

  private createEventDispatcher(): lark.EventDispatcher {
    const dispatcher = new lark.EventDispatcher({
      encryptKey: process.env.LARK_ENCRYPT_KEY,
      loggerLevel: lark.LoggerLevel.info,
    });

    dispatcher.register({
      'im.message.receive_v1': this.handleMessageReceive.bind(this),
    });

    return dispatcher;
  }

  /**
   * Handle incoming message event by delegating to MessageProcessor
   * Optimized for Lark's 3-second webhook timeout using non-blocking execution.
   */
  private async handleMessageReceive(data: LarkMessageEvent): Promise<void> {
    const { message, sender, event_id } = data;
    const chatId = message.chat_id || '';
    const messageId = message.message_id || '';
    const context: LogContext = { chatId, messageId, eventId: event_id };

    try {
      if (sender?.sender_type === 'app') return;
      
      // Use event_id for more robust idempotency check if available, fallback to message_id
      const idToDedup = event_id || messageId;
      if (!(await this.shouldProcessMessage(idToDedup, chatId))) {
        logger.debug(`Skipping duplicate message/event`, context);
        return;
      }

      // Proactive cleanup
      const now = Date.now();
      if (Math.random() < 0.01 || now - this.lastCleanupTime > this.CLEANUP_INTERVAL_MS) {
        this.lastCleanupTime = now;
        await this.storage.cleanup(this.CONVERSATION_TTL_MS);
      }

      // In Vercel serverless runtime, fire-and-forget async work may be terminated
      // once the request lifecycle ends, so we await processing there.
      const promise = this.processMessageAsync(data, context).catch(err => {
        logger.error(`Async message processing failed`, context, err);
      }).finally(() => {
        this.pendingPromises.delete(promise);
      });
      this.pendingPromises.add(promise);

      if (this.shouldAwaitMessageProcessing()) {
        await promise;
      }

    } catch (error) {
      logger.error(`Error in handleMessageReceive`, context, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Actual message processing logic executed asynchronously.
   * In Vercel, wraps processing in a 50-second timeout to stay within the 60-second function limit.
   */
  private async processMessageAsync(data: LarkMessageEvent, context: LogContext): Promise<void> {
    const { message, event_id } = data;
    const messageId = message.message_id || '';
    const chatId = message.chat_id || '';
    const isThreadMessage = !!message.root_id;

    const PROCESSING_TIMEOUT_MS = 290_000; // 10s buffer before Vercel's 300s limit

    const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Processing timed out after ${ms}ms`)), ms);
      });
      return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    };

    try {
      const processPromise = this.messageProcessor.process(data);
      const responseText = this.shouldAwaitMessageProcessing()
        ? await withTimeout(processPromise, PROCESSING_TIMEOUT_MS)
        : await processPromise;

      if (responseText && messageId) {
        // Use event_id as uuid for Lark API idempotency
        await this.sendMessageWithRetry(messageId, responseText, context, event_id, 3, isThreadMessage);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Error processing message`, context, err);

      try {
        if (!messageId) {
          logger.warn(`Cannot send error reply: missing messageId`, context);
          return;
        }
        const errorReply = await this.llmService.generateLlmErrorReply('', err);
        await this.sendMessageWithRetry(
          messageId,
          errorReply,
          context,
          event_id ? `${event_id}_err` : undefined,
          3,
          isThreadMessage
        );
      } catch (sendError) {
        logger.error(`Failed to send error message`, context, sendError as Error);
      }
    }
  }

  /**
   * Wait for all pending async message processing tasks to complete.
   * Useful for deterministic testing.
   */
  public async waitForPendingProcessing(): Promise<void> {
    while (this.pendingPromises.size > 0) {
      await Promise.all(Array.from(this.pendingPromises));
    }
  }

  /**
   * Deduplication logic with guard clauses
   */
  private async shouldProcessMessage(messageId?: string, chatId?: string): Promise<boolean> {
    if (!messageId) return true;

    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (redisUrl && redisToken) {
      const success = await this.checkRedisDedup(redisUrl, redisToken, messageId, chatId);
      if (!success) return false;
    }

    return this.checkInMemoryDedup(messageId);
  }

  private async checkRedisDedup(url: string, token: string, messageId: string, chatId?: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['SET', `dedup:bot-message:${chatId || 'unknown'}:${messageId}`, '1', 'EX', String(this.MESSAGE_DEDUP_TTL_SECONDS), 'NX']),
        signal: AbortSignal.timeout(1000),
      });

      if (response.ok) {
        const payload = (await response.json()) as { result?: string | null };
        return payload.result === 'OK';
      }
    } catch (error) {
      logger.warn('Redis dedup failed, using in-memory', { chatId, messageId }, error as Error);
    }
    return true; // Fallback to in-memory
  }

  private checkInMemoryDedup(messageId: string): boolean {
    const now = Date.now();
    // Inline cleanup of expired IDs
    for (const [id, ts] of this.processedMessageIds.entries()) {
      if (now - ts > this.MESSAGE_DEDUP_TTL_MS) this.processedMessageIds.delete(id);
    }

    const previous = this.processedMessageIds.get(messageId);
    if (previous && now - previous <= this.MESSAGE_DEDUP_TTL_MS) return false;

    this.processedMessageIds.set(messageId, now);
    return true;
  }

  /**
   * Send message with retry logic and exponential backoff
   */
  private async sendMessageWithRetry(
    messageId: string,
    text: string,
    context: LogContext,
    uuid?: string,
    maxRetries = 3,
    replyInThread = false
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await sendReplyMessage(this.larkClient, messageId, text, uuid, replyInThread);
        if (attempt > 0) logger.info(`Sent after retry`, context, { attempt });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Send attempt ${attempt + 1} failed`, context, lastError);

        if (!this.isRetryableError(lastError) || attempt >= maxRetries) break;

        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new LarkAPIError(`Failed after ${maxRetries + 1} attempts`, lastError);
  }

  private isRetryableError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    const nonRetryableCodes = ['400', '401', '403', '404'];
    if (nonRetryableCodes.some(code => msg.includes(code))) return false;
    
    const retryableIndicators = ['timeout', 'econnreset', 'enotfound', '500', '502', '503', '504', '429', 'rate limit'];
    return retryableIndicators.some(ind => msg.includes(ind));
  }

  /**
   * In serverless runtimes such as Vercel, background async tasks are not guaranteed
   * to continue after the handler returns.
   */
  private shouldAwaitMessageProcessing(): boolean {
    return process.env.VERCEL === '1' || !!process.env.VERCEL_ENV;
  }

  getEventDispatcher(): lark.EventDispatcher { return this.eventDispatcher; }
  getStorage(): ConversationStorage { return this.storage; }
  getLLMService(): LLMService { return this.llmService; }
  getToolExecutor(): ToolExecutor { return this.toolExecutor; }
  getMessageProcessor(): MessageProcessor { return this.messageProcessor; }
}
