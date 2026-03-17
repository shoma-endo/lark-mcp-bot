import {
  LarkMessageEvent,
  LarkTextContent,
  LogContext,
  ConversationMessage,
} from '../types.js';
import { logger } from '../utils/logger.js';
import { LLMService } from './llm-service.js';
import { ToolExecutor } from './tool-executor.js';
import { ConversationStorage } from '../storage/interface.js';
import { config } from '../config.js';
import {
  IntentPlanner,
  IntentPlannerLike,
  IntentPlan,
  RequesterIdentity,
} from './intent-planner.js';

export class MessageProcessor {
  private readonly SUMMARY_TRIGGER_MESSAGES = 24;
  private readonly SUMMARY_KEEP_RECENT = 12;

  constructor(
    private llmService: LLMService,
    private toolExecutor: ToolExecutor,
    private storage: ConversationStorage,
    private intentPlanner: IntentPlannerLike = new IntentPlanner()
  ) {}

  /**
   * Main entry point for processing a Lark message
   */
  async process(data: LarkMessageEvent): Promise<string> {
    const { message, sender } = data;
    const chatId = message.chat_id || '';
    const userId = sender?.sender_id?.user_id || 'unknown';
    const context: LogContext = { chatId, userId, messageId: message.message_id };
    const metricId = `process_message_${chatId}_${Date.now()}`;
    const requesterIdentity = this.resolveRequesterIdentity(sender?.sender_id);

    try {
      logger.startMetric(metricId, 'process_message', { chatId, userId });

      const parsedContent = this.parseMessageContent(message.content);
      const messageText = parsedContent.text;
      if (!messageText) {
        logger.debug(`Skipping empty message`, context);
        return '';
      }

      const isGroup = message.chat_type === 'group';
      const isMentioned = parsedContent.hasMention || this.hasMentions(messageText);
      const isThread = !!message.root_id;

      // In group chats, only process if mentioned or it's a thread (to avoid noise)
      if (isGroup && !isMentioned && !isThread) {
        logger.debug(`Skipping group message: not mentioned and not in thread`, context);
        return '';
      }

      let history = await this.storage.getHistory(chatId);
      await this.storage.setTimestamp(chatId, Date.now());
      history = await this.maybeSummarizeHistory(history, context);

      const cleanText = this.removeMentions(messageText);
      const intentPlan = this.intentPlanner.createPlan(cleanText);
      history.push({ role: 'user', content: intentPlan.normalizedUserText || cleanText });

      const systemPrompt = this.buildSystemPrompt(intentPlan);
      const messagesForLlm = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-20),
      ];

      const functions = this.toolExecutor.convertMcpToolsToFunctions();
      const completion = await this.llmService.createCompletion(messagesForLlm as ConversationMessage[], functions);
      
      const responseMessage = completion.choices[0]?.message;
      if (!responseMessage) {
        throw new Error('LLM returned no response choices');
      }
      const toolCalls = responseMessage.tool_calls;

      let finalResponse: string;

      if (toolCalls && toolCalls.length > 0) {
        finalResponse = await this.handleToolCallsRecursive(
          chatId,
          history,
          responseMessage,
          toolCalls,
          systemPrompt,
          context,
          requesterIdentity,
          intentPlan
        );
      } else {
        finalResponse = responseMessage.content?.trim() || '';
        if (!finalResponse) throw new Error('LLM returned empty response');
        
        finalResponse = this.sanitizeReplyText(finalResponse);
        history.push({ role: 'assistant', content: finalResponse });
      }

      // Maintain history size
      const maxHistory = toolCalls ? 30 : 20;
      if (history.length > maxHistory) {
        history.splice(0, history.length - maxHistory);
      }

      await this.storage.setHistory(chatId, history);
      logger.endMetric(metricId, context, { responseLength: finalResponse.length });

      return finalResponse;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Error in MessageProcessor', context, err);
      throw err;
    }
  }

  /**
   * Handle one or more tool calls and get a follow-up response
   */
  private async handleToolCallsRecursive(
    chatId: string,
    history: ConversationMessage[],
    assistantMessage: any,
    toolCalls: any[],
    systemPrompt: string,
    context: LogContext,
    requesterIdentity: RequesterIdentity,
    intentPlan: IntentPlan
  ): Promise<string> {
    const mutationResultUrls = new Set<string>();
    const toolErrors: string[] = [];
    const functions = this.toolExecutor.convertMcpToolsToFunctions();
    const availableToolNames = new Set(this.toolExecutor.convertMcpToolsToFunctions().map(f => f.function.name));
    const executeToolCalls = async (calls: any[]): Promise<void> => {
      for (const toolCall of calls) {
        const functionName = toolCall.function.name;
        const rawArgs = toolCall.function.arguments;
        const functionArgs = this.enrichToolArgumentsForRequester(
          functionName,
          this.parseToolArguments(rawArgs, functionName, context),
          requesterIdentity,
          intentPlan
        );

        let result = await this.toolExecutor.executeToolCall(functionName, functionArgs);
        if (result.startsWith('Error:') || result.startsWith('Error executing tool:')) {
          toolErrors.push(`[${functionName}] ${result}`);
        }
        const postCheck = await this.tryPostCheck(functionName, functionArgs, result, availableToolNames, context);
        if (postCheck) {
          result = `${result}\n\n${postCheck}`;
        }
        history.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: functionName,
          content: result,
        });
        this.toolExecutor.buildMutationResultLinks(functionName, result).forEach(url => mutationResultUrls.add(url));
      }
    };

    // Add original assistant message with tool calls to history
    history.push({
      role: 'assistant',
      content: assistantMessage.content || '',
      tool_calls: toolCalls as ConversationMessage['tool_calls'],
    });

    // Execute all tool calls in this turn
    await executeToolCalls(toolCalls);

    let finalResponse = '';
    const maxFollowUpAttempts = 3;
    for (let attempt = 1; attempt <= maxFollowUpAttempts; attempt++) {
      const followUpMessages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-20),
      ];

      const followUpCompletion = await this.llmService.createCompletion(
        followUpMessages as ConversationMessage[],
        functions
      );
      const followUpMessage = followUpCompletion.choices[0]?.message;
      if (!followUpMessage) {
        logger.warn('LLM returned no follow-up response choices', context, undefined, { attempt });
        continue;
      }

      const followUpToolCalls = followUpMessage.tool_calls;
      if (followUpToolCalls && followUpToolCalls.length > 0) {
        history.push({
          role: 'assistant',
          content: followUpMessage.content || '',
          tool_calls: followUpToolCalls as ConversationMessage['tool_calls'],
        });
        await executeToolCalls(followUpToolCalls);
        continue;
      }

      finalResponse = followUpMessage.content?.trim() || '';
      if (finalResponse) break;
      logger.warn('LLM returned empty follow-up response', context, undefined, { attempt });
    }

    if (!finalResponse) {
      finalResponse = '処理は完了しましたが、最終メッセージの生成に失敗しました。必要であればもう一度お試しください。';
    }

    // Append tool errors so the user can see the raw details
    if (toolErrors.length > 0) {
      finalResponse += '\n\nツールエラー詳細:\n' + toolErrors.join('\n');
    }

    // Append mutation links if any
    if (mutationResultUrls.size > 0) {
      finalResponse += '\n\n' + Array.from(mutationResultUrls).join('\n');
    }

    finalResponse = this.sanitizeReplyText(finalResponse);
    history.push({ role: 'assistant', content: finalResponse });

    return finalResponse;
  }

  private async maybeSummarizeHistory(
    history: ConversationMessage[],
    context: LogContext
  ): Promise<ConversationMessage[]> {
    if (history.length <= this.SUMMARY_TRIGGER_MESSAGES) return history;

    const existingSummary = history.find(
      msg => msg.role === 'system' && msg.content.startsWith('会話要約:')
    );
    const nonSummaryHistory = history.filter(
      msg => !(msg.role === 'system' && msg.content.startsWith('会話要約:'))
    );
    const recent = nonSummaryHistory.slice(-this.SUMMARY_KEEP_RECENT);
    const toSummarize = nonSummaryHistory.slice(0, Math.max(0, nonSummaryHistory.length - this.SUMMARY_KEEP_RECENT));
    if (toSummarize.length === 0) return history;

    try {
      const summaryPrompt: ConversationMessage[] = [
        {
          role: 'system',
          content: '以下の会話履歴を、目的・合意事項・未完了タスク・重要なID/URLに分けて日本語で簡潔に要約してください。1000文字以内。'
        },
        {
          role: 'user',
          content: JSON.stringify({
            previous_summary: existingSummary?.content || '',
            messages: toSummarize,
          }),
        },
      ];
      const completion = await this.llmService.createCompletion(summaryPrompt);
      const summaryText = completion.choices[0]?.message?.content?.trim();
      if (!summaryText) return history;

      return [
        { role: 'system', content: `会話要約:\n${summaryText}` },
        ...recent,
      ];
    } catch (error) {
      logger.warn('Failed to summarize history', context, error as Error);
      return history;
    }
  }

  private async tryPostCheck(
    functionName: string,
    functionArgs: Record<string, unknown>,
    toolResult: string,
    availableToolNames: Set<string>,
    context: LogContext
  ): Promise<string | null> {
    if (!this.toolExecutor.isMutationTool(functionName)) return null;

    const postCheckTool = this.findPostCheckTool(functionName, availableToolNames);
    if (!postCheckTool) return null;

    const postCheckArgs = this.buildPostCheckArgs(functionArgs, toolResult);
    if (!postCheckArgs) return null;

    const postCheckResult = await this.toolExecutor.executeToolCall(postCheckTool, postCheckArgs);
    if (postCheckResult.startsWith('Error:') || postCheckResult.startsWith('Error executing tool:')) {
      logger.warn('Post-check failed', context, undefined, { mutationTool: functionName, postCheckTool });
      return null;
    }
    return `Post-check (${postCheckTool}): ${postCheckResult}`;
  }

  private findPostCheckTool(toolName: string, availableToolNames: Set<string>): string | null {
    const base = toolName.replace(/\.(create|patch|update|batchCreate|batchUpdate)$/, '');
    const candidates = [`${base}.get`, `${base}.list`, `${base}.search`];
    return candidates.find(name => availableToolNames.has(name)) || null;
  }

  private buildPostCheckArgs(
    functionArgs: Record<string, unknown>,
    toolResult: string
  ): Record<string, unknown> | null {
    const seedKeys = [
      'id', 'user_id', 'chat_id', 'calendar_id', 'event_id', 'task_id',
      'record_id', 'table_id', 'app_token', 'document_id', 'document_token',
      'spreadsheet_token', 'sheet_id', 'node_id', 'node_token', 'file_token',
      'token', 'obj_token',
    ];
    const args: Record<string, unknown> = {};
    for (const key of seedKeys) {
      if (functionArgs[key] !== undefined) args[key] = functionArgs[key];
    }

    try {
      const parsed = JSON.parse(toolResult) as Record<string, unknown>;
      for (const key of seedKeys) {
        if (args[key] === undefined && parsed[key] !== undefined) {
          args[key] = parsed[key];
        }
      }
    } catch {
      // ignore non-JSON result
    }

    return Object.keys(args).length > 0 ? args : null;
  }

  private parseMessageContent(content?: string): { text: string; hasMention: boolean } {
    if (!content) return { text: '', hasMention: false };
    try {
      const parsed = JSON.parse(content) as LarkTextContent | Record<string, unknown>;
      const directText = typeof (parsed as LarkTextContent).text === 'string'
        ? (parsed as LarkTextContent).text
        : '';
      const extractedText = directText || this.extractTextFromStructuredContent(parsed);

      return {
        text: extractedText || '',
        hasMention: this.hasStructuredMention(parsed) || this.hasMentions(directText || extractedText || ''),
      };
    } catch {
      return {
        text: content || '',
        hasMention: this.hasMentions(content || ''),
      };
    }
  }

  private removeMentions(text: string): string {
    return text
      .replace(/<at\b[^>]*>.*?<\/at>\s*/gi, '')
      .replace(/@_user_\d+\s*/g, '')
      .trim();
  }

  private hasMentions(text: string): boolean {
    return /@_user_\d+|<at\b[^>]*>/i.test(text);
  }

  private hasStructuredMention(value: unknown): boolean {
    if (Array.isArray(value)) {
      return value.some(item => this.hasStructuredMention(item));
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (record.tag === 'at') return true;
      return Object.values(record).some(item => this.hasStructuredMention(item));
    }
    return false;
  }

  private extractTextFromStructuredContent(value: unknown): string {
    const parts: string[] = [];

    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (!node || typeof node !== 'object') return;

      const record = node as Record<string, unknown>;
      if (typeof record.text === 'string') {
        parts.push(record.text);
      }

      for (const [key, child] of Object.entries(record)) {
        if (key === 'text') continue;
        visit(child);
      }
    };

    visit(value);
    return parts.join('').trim();
  }

  private buildSystemPrompt(intentPlan: IntentPlan): string {
    const functions = this.toolExecutor.convertMcpToolsToFunctions();
    const toolDocs = functions.map(f => `- ${f.function.name}: ${f.function.description}`).join('\n');
    const plannerHints = intentPlan.slotHints.intent
      ? `\nPlanner hints:\n- intent: ${intentPlan.slotHints.intent}\n- time_min: ${intentPlan.slotHints.timeMin || '(none)'}\n- time_max: ${intentPlan.slotHints.timeMax || '(none)'}\n- confidence: ${intentPlan.slotHints.confidence}`
      : '';
    
    return `あなたはLarkのAIアシスタントボットです。
ユーザーのリクエストに応じてLark APIを通じて様々な操作を実行できます。

利用可能なツール:
${toolDocs}
${plannerHints}

重要: tool call の arguments は必ず厳密なJSON objectを出力してください。XML風タグ（<tool_call>, <arg_value>）や key=value 連結形式は使用禁止です。
例: calendar.v4.freebusy.list の arguments は {"time_min":"2025-02-18T00:00:00+09:00","time_max":"2025-02-25T00:00:00+09:00","user_ids":["me"]} のようなJSONにしてください。

日本語で丁寧に答えてください。ツールを実行する必要がある場合は、適切なツールを選択してください。Markdown記法や記号装飾（例: **, #）は使わず、プレーンテキストで回答してください。
ツール実行でエラーが発生した場合は、エラーメッセージを省略せずそのままユーザーに伝えてください。`;
  }

  private sanitizeReplyText(text: string): string {
    return text
      .replace(/\*\*/g, '')
      .replace(/^#{1,6}\s*/gm, '')
      .trim();
  }

  private enrichToolArgumentsForRequester(
    toolName: string,
    args: Record<string, unknown>,
    requesterIdentity: RequesterIdentity,
    intentPlan: IntentPlan
  ): Record<string, unknown> {
    const preferOpenId = toolName.startsWith('contact.') || toolName === 'calendar.v4.freebusy.list';
    const enriched = this.applyRequesterIdentity(args, requesterIdentity, undefined, preferOpenId) as Record<string, unknown>;

    if (toolName.startsWith('contact.')) {
      return this.applyUserIdTypeForContact(enriched, requesterIdentity);
    }

    if (toolName !== 'calendar.v4.freebusy.list') return enriched;

    const requester = this.resolveRequesterId(requesterIdentity);
    if (!requester) return enriched;

    const params = (enriched.params && typeof enriched.params === 'object' && !Array.isArray(enriched.params))
      ? { ...(enriched.params as Record<string, unknown>) }
      : {};
    const data = (enriched.data && typeof enriched.data === 'object' && !Array.isArray(enriched.data))
      ? { ...(enriched.data as Record<string, unknown>) }
      : {};

    const hintedTimeMin = intentPlan.slotHints.timeMin;
    const hintedTimeMax = intentPlan.slotHints.timeMax;
    if (!enriched.time_min && !data.time_min && hintedTimeMin) {
      enriched.time_min = hintedTimeMin;
    }
    if (!enriched.time_max && !data.time_max && hintedTimeMax) {
      enriched.time_max = hintedTimeMax;
    }

    const flatUserIds = Array.isArray(enriched.user_ids)
      ? (enriched.user_ids as unknown[]).map(v => String(v))
      : [];
    if (flatUserIds.length > 0) {
      const replaced = flatUserIds.map(v => v === 'me' ? requester.id : v);
      enriched.user_ids = replaced;
      if (!enriched.user_id && !data.user_id && !enriched.room_id && !data.room_id) {
        enriched.user_id = replaced[0];
      }
    }

    if (enriched.user_id === 'me') {
      enriched.user_id = requester.id;
    }
    if (data.user_id === 'me') {
      data.user_id = requester.id;
    }

    const hasAnyTarget = !!(enriched.user_id || enriched.room_id || data.user_id || data.room_id);
    if (!hasAnyTarget) {
      enriched.user_id = requester.id;
    }

    if (
      !enriched.user_id_type &&
      !params.user_id_type &&
      (!enriched.room_id && !data.room_id)
    ) {
      enriched.user_id_type = requester.type;
    }

    if (Object.keys(data).length > 0) enriched.data = data;
    if (Object.keys(params).length > 0) enriched.params = params;
    return enriched;
  }

  private resolveRequesterId(requesterIdentity: { userId?: string; openId?: string; unionId?: string }):
    { id: string; type: 'user_id' | 'open_id' | 'union_id' } | null {
    if (requesterIdentity.openId) return { id: requesterIdentity.openId, type: 'open_id' };
    if (requesterIdentity.userId) return { id: requesterIdentity.userId, type: 'user_id' };
    if (requesterIdentity.unionId) return { id: requesterIdentity.unionId, type: 'union_id' };
    return null;
  }

  private resolveRequesterIdentity(senderId?: {
    user_id?: string;
    open_id?: string;
    union_id?: string;
  }): RequesterIdentity {
    const getEnv = (...keys: string[]): string | undefined => {
      for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
      }
      return undefined;
    };

    return {
      userId: getEnv('DEFAULT_USER_ID', 'LARK_DEFAULT_USER_ID') || senderId?.user_id,
      openId: getEnv('DEFAULT_OPEN_ID', 'LARK_DEFAULT_OPEN_ID') || senderId?.open_id,
      unionId: getEnv('DEFAULT_UNION_ID', 'LARK_DEFAULT_UNION_ID') || senderId?.union_id,
      email: getEnv('DEFAULT_USER_EMAIL', 'LARK_DEFAULT_USER_EMAIL'),
      mobile: getEnv('DEFAULT_USER_MOBILE', 'LARK_DEFAULT_USER_MOBILE'),
    };
  }

  private applyRequesterIdentity(
    value: unknown,
    requesterIdentity: { userId?: string; openId?: string; unionId?: string; email?: string; mobile?: string },
    keyHint?: string,
    preferOpenId = false
  ): unknown {
    if (Array.isArray(value)) {
      return value.map(item => this.applyRequesterIdentity(item, requesterIdentity, keyHint, preferOpenId));
    }

    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(obj)) {
        const replaced = this.applyRequesterIdentity(child, requesterIdentity, key, preferOpenId);
        if (this.isIdentityKey(key) && this.isIdentityPlaceholderValue(replaced)) {
          next[key] = this.getIdentityValueForKey(key, requesterIdentity, preferOpenId);
        } else if (this.isIdentityArrayKey(key) && Array.isArray(replaced) && replaced.length === 0) {
          next[key] = this.getIdentityValueForKey(key, requesterIdentity, preferOpenId);
        } else {
          next[key] = replaced;
        }
      }
      return next;
    }

    if (typeof value !== 'string') return value;
    const scalar = this.sanitizeLooseScalar(value);
    if (!this.isIdentityPlaceholder(scalar)) return scalar;
    return this.getIdentityValueForKey(keyHint, requesterIdentity, preferOpenId);
  }

  private isIdentityPlaceholder(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized === 'me' || normalized === 'self' || normalized === 'current_user' || normalized === '@me';
  }

  private isIdentityPlaceholderValue(value: unknown): boolean {
    return typeof value === 'string' && this.isIdentityPlaceholder(this.sanitizeLooseScalar(value));
  }

  private isIdentityArrayKey(key: string): boolean {
    const normalized = key.toLowerCase();
    return normalized.endsWith('_ids') || ['user_ids', 'open_ids', 'union_ids', 'emails', 'mobiles', 'phones'].includes(normalized);
  }

  private isIdentityKey(key: string): boolean {
    const normalized = key.toLowerCase();
    return [
      'user_id', 'open_id', 'union_id', 'email', 'mobile', 'phone',
      'user_ids', 'open_ids', 'union_ids', 'emails', 'mobiles', 'phones',
    ].includes(normalized) || normalized.endsWith('_user_id');
  }

  private getIdentityValueForKey(
    keyHint: string | undefined,
    requesterIdentity: { userId?: string; openId?: string; unionId?: string; email?: string; mobile?: string },
    preferOpenId = false
  ): string | string[] {
    const key = (keyHint || '').toLowerCase();
    const primary = preferOpenId
      ? (requesterIdentity.openId || requesterIdentity.userId || requesterIdentity.unionId || '')
      : (requesterIdentity.userId || requesterIdentity.openId || requesterIdentity.unionId || '');

    if (key === 'open_id' || key === 'open_ids') {
      const value = requesterIdentity.openId || primary;
      return key.endsWith('s') ? (value ? [value] : []) : value;
    }
    if (key === 'union_id' || key === 'union_ids') {
      const value = requesterIdentity.unionId || primary;
      return key.endsWith('s') ? (value ? [value] : []) : value;
    }
    if (key === 'email' || key === 'emails') {
      const value = requesterIdentity.email || '';
      return key.endsWith('s') ? (value ? [value] : []) : value;
    }
    if (key === 'mobile' || key === 'mobiles' || key === 'phone' || key === 'phones') {
      const value = requesterIdentity.mobile || '';
      return key.endsWith('s') ? (value ? [value] : []) : value;
    }

    if (key.endsWith('_ids')) {
      return primary ? [primary] : [];
    }
    return primary;
  }

  private applyUserIdTypeForContact(
    args: Record<string, unknown>,
    requesterIdentity: RequesterIdentity
  ): Record<string, unknown> {
    const next: Record<string, unknown> = { ...args };
    const params = (next.params && typeof next.params === 'object' && !Array.isArray(next.params))
      ? { ...(next.params as Record<string, unknown>) }
      : {};
    const data = (next.data && typeof next.data === 'object' && !Array.isArray(next.data))
      ? { ...(next.data as Record<string, unknown>) }
      : {};

    if (requesterIdentity.openId) {
      if (!next.user_id && !data.user_id) {
        next.user_id = requesterIdentity.openId;
      }
      if (!next.user_id_type && !params.user_id_type) {
        next.user_id_type = 'open_id';
      }
    }

    if (Object.keys(data).length > 0) next.data = data;
    if (Object.keys(params).length > 0) next.params = params;
    return next;
  }

  private parseToolArguments(rawArgs: unknown, functionName: string, context: LogContext): Record<string, unknown> {
    if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
      return rawArgs as Record<string, unknown>;
    }
    if (typeof rawArgs !== 'string') {
      logger.warn(`Tool arguments are not an object/string for ${functionName}`, context, undefined, { rawArgs });
      return {};
    }

    const trimmed = rawArgs.trim();
    if (!trimmed) return {};

    // Check if JSON is potentially truncated (unbalanced braces)
    const openBraces = (trimmed.match(/\{/g) || []).length;
    const closeBraces = (trimmed.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
      logger.warn(`Tool arguments appear truncated for ${functionName}: unbalanced braces`, context, undefined, {
        rawArgsPreview: trimmed.length > 500 ? trimmed.substring(0, 500) + '...' : trimmed,
        rawArgsLength: trimmed.length,
        openBraces,
        closeBraces,
        missingClosingBraces: openBraces - closeBraces,
      });
      logger.warn(`This may indicate max_tokens limit in LLMService createCompletion. Current max_tokens: ${config.glmMaxTokens}`, context);
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch (error) {
      logger.warn(`JSON.parse failed for ${functionName}, trying fallback parsers`, context, undefined, {
        rawArgsPreview: trimmed.length > 500 ? trimmed.substring(0, 500) + '...' : trimmed,
        rawArgsLength: trimmed.length,
        parseError: error instanceof Error ? error.message : String(error),
      });
      // fallback below
    }

    const taggedParsed = this.parseTaggedKeyValueArgs(trimmed);
    if (taggedParsed) return taggedParsed;

    const functionNamePattern = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalized = trimmed
      .replace(/<\/?[^>]+>/g, '')
      .replace(new RegExp(`^${functionNamePattern}:`), '')
      .trim();

    try {
      const parsed = JSON.parse(normalized);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fallback below
    }

    const kvParsed = this.parseLegacyKeyValueArgs(normalized);
    if (kvParsed) return kvParsed;

    logger.error(`Failed to parse tool arguments for ${functionName}, returning empty object`, context, undefined, {
      rawArgs: trimmed.length > 1000 ? trimmed.substring(0, 1000) + '...' : trimmed,
      rawArgsLength: trimmed.length,
      functionName,
    });
    return {};
  }

  private parseLegacyKeyValueArgs(input: string): Record<string, unknown> | null {
    const source = input.replace(/:+$/, '');
    const matches = [...source.matchAll(/([a-zA-Z0-9_]+)=([\s\S]*?)(?=:[a-zA-Z0-9_]+=|$)/g)];
    if (matches.length === 0) return null;

    const parsed: Record<string, unknown> = {};
    for (const [, key, rawValue] of matches) {
      const value = this.sanitizeLooseScalar(rawValue.trim().replace(/:+$/, ''));
      if (!value) continue;

      if (key.endsWith('_ids')) {
        parsed[key] = value.split(',').map(v => v.trim()).filter(Boolean);
        continue;
      }

      if (value === 'true' || value === 'false') {
        parsed[key] = value === 'true';
        continue;
      }

      const num = Number(value);
      parsed[key] = Number.isFinite(num) && /^-?\d+(\.\d+)?$/.test(value) ? num : value;
    }

    return Object.keys(parsed).length > 0 ? parsed : null;
  }

  private parseTaggedKeyValueArgs(input: string): Record<string, unknown> | null {
    const pairPattern = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;
    const matches = [...input.matchAll(pairPattern)];
    if (matches.length === 0) return null;

    const parsed: Record<string, unknown> = {};
    for (const [, rawKey, rawValue] of matches) {
      const key = rawKey.trim();
      const value = this.sanitizeLooseScalar(rawValue.trim());
      if (!key) continue;
      if (key.endsWith('_ids')) {
        try {
          const parsedArray = JSON.parse(value);
          if (Array.isArray(parsedArray)) {
            parsed[key] = parsedArray.map(v => String(v));
            continue;
          }
        } catch {
          // fallback below
        }
        parsed[key] = value.split(',').map(v => this.sanitizeLooseScalar(v.trim())).filter(Boolean);
        continue;
      }
      parsed[key] = value;
    }
    return Object.keys(parsed).length > 0 ? parsed : null;
  }

  private sanitizeLooseScalar(value: string): string {
    return value.replace(/^"+|"+$/g, '').trim();
  }
}
