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

export class MessageProcessor {
  constructor(
    private llmService: LLMService,
    private toolExecutor: ToolExecutor,
    private storage: ConversationStorage
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

      const history = await this.storage.getHistory(chatId);
      await this.storage.setTimestamp(chatId, Date.now());

      const cleanText = this.removeMentions(messageText);
      history.push({ role: 'user', content: cleanText });

      const systemPrompt = this.buildSystemPrompt();
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
        finalResponse = await this.handleToolCallsRecursive(chatId, history, responseMessage, toolCalls, systemPrompt, context);
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
    context: LogContext
  ): Promise<string> {
    const mutationResultUrls = new Set<string>();

    // Add original assistant message with tool calls to history
    history.push({
      role: 'assistant',
      content: assistantMessage.content || '',
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
    });

    // Execute all tool calls in this turn
    for (const toolCall of toolCalls) {
      const functionName = toolCall.function.name;
      const rawArgs = toolCall.function.arguments;
      let functionArgs: Record<string, unknown>;
      try {
        functionArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
      } catch (parseError) {
        logger.warn(`Failed to parse tool arguments for ${functionName}`, context, parseError as Error, { rawArgs });
        functionArgs = {};
      }

      const result = await this.toolExecutor.executeToolCall(functionName, functionArgs);
      
      history.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: functionName,
        content: result,
      });

      this.toolExecutor.buildMutationResultLinks(functionName, result).forEach(url => mutationResultUrls.add(url));
    }

    // Get follow-up from LLM
    const followUpMessages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-20),
    ];

    const followUpCompletion = await this.llmService.createCompletion(followUpMessages as ConversationMessage[]);
    const followUpMessage = followUpCompletion.choices[0]?.message;
    if (!followUpMessage) {
      throw new Error('LLM returned no follow-up response choices');
    }
    let finalResponse = followUpMessage.content?.trim() || '';
    
    if (!finalResponse) throw new Error('LLM returned empty follow-up response');

    // Append mutation links if any
    if (mutationResultUrls.size > 0) {
      finalResponse += '\n\n' + Array.from(mutationResultUrls).join('\n');
    }

    finalResponse = this.sanitizeReplyText(finalResponse);
    history.push({ role: 'assistant', content: finalResponse });

    return finalResponse;
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

  private buildSystemPrompt(): string {
    const functions = this.toolExecutor.convertMcpToolsToFunctions();
    const toolDocs = functions.map(f => `- ${f.function.name}: ${f.function.description}`).join('\n');
    
    return `あなたはLarkのAIアシスタントボットです。
ユーザーのリクエストに応じてLark APIを通じて様々な操作を実行できます。

利用可能なツール:
${toolDocs}

日本語で丁寧に答えてください。ツールを実行する必要がある場合は、適切なツールを選択してください。Markdown記法や記号装飾（例: **, #）は使わず、プレーンテキストで回答してください。`;
  }

  private sanitizeReplyText(text: string): string {
    return text
      .replace(/\*\*/g, '')
      .replace(/^#{1,6}\s*/gm, '')
      .trim();
  }
}
