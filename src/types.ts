/**
 * Shared type definitions for lark-mcp-bot
 */

/**
 * Message roles in conversation
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Tool call structure from LLM
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

/**
 * Conversation message structure
 */
export interface ConversationMessage {
  role: MessageRole;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/**
 * GLM function definition for tool calling
 */
export interface FunctionDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/**
 * MCP Tool schema structure
 */
export interface MCPToolSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

/**
 * MCP Tool structure from @larksuiteoapi/lark-mcp
 */
export interface MCPTool {
  name: string;
  description: string;
  schema: MCPToolSchema;
  project?: string;
}

/**
 * MCP Tool execution result
 */
export interface MCPToolResult {
  content?: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
}

/**
 * Lark message event data
 * Matches the structure from @larksuiteoapi/node-sdk
 */
export interface LarkMessageEvent {
  event_id?: string;
  token?: string;
  create_time?: string;
  event_type?: string;
  tenant_key?: string;
  ts?: string;
  message: {
    message_id?: string;
    chat_id?: string;
    content?: string;
    message_type?: string;
    root_id?: string;
    parent_id?: string;
    create_time?: string;
    chat_type?: string;
  };
  sender?: {
    sender_id?: {
      user_id?: string;
      open_id?: string;
      union_id?: string;
    };
    sender_type?: string;
    tenant_key?: string;
  };
}

/**
 * Lark message content structure
 */
export interface LarkTextContent {
  text: string;
}

/**
 * Custom error types for better error handling
 */
export class LarkBotError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly statusCode?: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'LarkBotError';
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to user-friendly message
   */
  toUserMessage(): string {
    return '申し訳ありません。エラーが発生しました。もう一度お試しください。';
  }
}

export class LLMError extends LarkBotError {
  constructor(message: string, cause?: Error, statusCode?: number) {
    super(message, 'LLM_ERROR', true, statusCode, cause);
    this.name = 'LLMError';
  }

  toUserMessage(): string {
    if (this.statusCode === 429) {
      return '申し訳ありません。現在リクエストが集中しています。しばらく待ってからお試しください。';
    }
    return '申し訳ありません。AI応答の生成中にエラーが発生しました。しばらくしてからお試しください。';
  }
}

export class ToolExecutionError extends LarkBotError {
  constructor(
    message: string,
    public readonly toolName: string,
    cause?: Error
  ) {
    super(message, 'TOOL_EXECUTION_ERROR', false, undefined, cause);
    this.name = 'ToolExecutionError';
  }

  toUserMessage(): string {
    return `申し訳ありません。ツール「${this.toolName}」の実行中にエラーが発生しました。`;
  }
}

export class LarkAPIError extends LarkBotError {
  constructor(message: string, cause?: Error, statusCode?: number) {
    super(message, 'LARK_API_ERROR', true, statusCode, cause);
    this.name = 'LarkAPIError';
  }

  toUserMessage(): string {
    if (this.statusCode === 401 || this.statusCode === 403) {
      return '申し訳ありません。認証エラーが発生しました。管理者に連絡してください。';
    }
    return '申し訳ありません。Lark APIとの通信中にエラーが発生しました。';
  }
}

export class RateLimitError extends LarkBotError {
  constructor(
    message: string,
    public readonly retryAfter?: number,
    cause?: Error
  ) {
    super(message, 'RATE_LIMIT_ERROR', true, 429, cause);
    this.name = 'RateLimitError';
  }

  toUserMessage(): string {
    if (this.retryAfter) {
      return `申し訳ありません。レート制限に達しました。${this.retryAfter}秒後に再試行してください。`;
    }
    return '申し訳ありません。レート制限に達しました。しばらく待ってからお試しください。';
  }
}

export class ResourcePackageError extends LarkBotError {
  constructor(message: string, cause?: Error) {
    super(message, 'RESOURCE_PACKAGE_ERROR', false, 429, cause);
    this.name = 'ResourcePackageError';
  }

  toUserMessage(): string {
    return '申し訳ありません。現在AI APIの利用枠（残高またはリソースパッケージ）が不足しています。管理者にご確認ください。';
  }
}

export class ValidationError extends LarkBotError {
  constructor(
    message: string,
    public readonly field?: string,
    cause?: Error
  ) {
    super(message, 'VALIDATION_ERROR', false, 400, cause);
    this.name = 'ValidationError';
  }

  toUserMessage(): string {
    if (this.field) {
      return `申し訳ありません。入力データが不正です（${this.field}）。`;
    }
    return '申し訳ありません。入力データが不正です。';
  }
}

/**
 * Logger interface for structured logging
 */
export interface LogContext {
  chatId?: string;
  userId?: string;
  toolName?: string;
  messageId?: string;
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
}
