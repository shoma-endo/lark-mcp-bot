import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  ConversationMessage,
  FunctionDefinition,
  LLMError,
  APIRateLimitError,
  ResourcePackageError,
  LarkBotError,
} from '../types.js';

export class LLMService {
  private openai: OpenAI;
  /** Base delay (ms) for retry backoff. Override in tests to speed up. */
  retryBaseDelayMs = 1000;

  constructor() {
    this.openai = new OpenAI({
      apiKey: config.glmApiKey,
      baseURL: config.glmApiBaseUrl,
      timeout: 30000, // 30 seconds timeout
    });
  }

  /**
   * Generate chat completion with retry on rate limit errors
   */
  async createCompletion(
    messages: ConversationMessage[],
    tools?: FunctionDefinition[],
    _maxRetries = 3
  ): Promise<OpenAI.Chat.ChatCompletion> {
    for (let attempt = 0; attempt <= _maxRetries; attempt++) {
      try {
        return await this.openai.chat.completions.create({
          model: config.glmModel,
          messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
          tools: tools as OpenAI.Chat.ChatCompletionTool[],
          temperature: 0.7,
          max_tokens: config.glmMaxTokens,
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const mappedError = this.mapApiErrorToBotError(error, err);

        const isRateLimit =
          mappedError instanceof APIRateLimitError ||
          err.message.includes('429') ||
          err.message.toLowerCase().includes('rate limit');

        if (isRateLimit && attempt < _maxRetries) {
          const delayMs = Math.pow(2, attempt) * this.retryBaseDelayMs; // 1x, 2x, 4x base delay
          logger.warn(`GLM API rate limited, retrying in ${delayMs}ms`, undefined, undefined, {
            attempt: attempt + 1,
            maxRetries: _maxRetries,
          });
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        if (mappedError) throw mappedError;
        if (isRateLimit) throw new APIRateLimitError('GLM API rate limit exceeded', err);
        throw new LLMError(`Failed to generate AI response: ${err.message}`, err);
      }
    }
    // Should never reach here
    throw new LLMError('Unexpected retry loop exit');
  }

  /**
   * Generate an error reply via LLM
   */
  async generateLlmErrorReply(userMessage: string, error: Error): Promise<string> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: config.glmModel,
        messages: [
          {
            role: 'system',
            content: 'あなたはLarkボットです。システムエラー時の短い案内文を日本語で1-2文で作成してください。憶測はせず、再試行や確認方法を具体的に示してください。Markdown記法や記号装飾（例: **, #）は使わないでください。',
          },
          {
            role: 'user',
            content: `ユーザー入力: ${userMessage || '(なし)'}\nエラー: ${error.message}\nこの状況でユーザーに返すメッセージを作成してください。`,
          },
        ],
        temperature: 0.2,
        max_tokens: Math.min(300, config.glmMaxTokens),
      });

      const text = completion.choices[0]?.message?.content?.trim();
      if (!text) {
        throw new Error('LLM returned empty error reply');
      }
      return text;
    } catch (err) {
      logger.error('Failed to generate LLM error reply', undefined, err as Error);
      return `エラーが発生しました: ${error.message}`;
    }
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
   * Extract detailed OpenAI-compatible API error fields for diagnostics.
   */
  getApiErrorDetails(error: unknown): Record<string, unknown> {
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
}
