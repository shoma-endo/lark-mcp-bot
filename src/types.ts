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
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'LarkBotError';
  }
}

export class LLMError extends LarkBotError {
  constructor(message: string, cause?: Error) {
    super(message, 'LLM_ERROR', true, cause);
    this.name = 'LLMError';
  }
}

export class ToolExecutionError extends LarkBotError {
  constructor(
    message: string,
    public readonly toolName: string,
    cause?: Error
  ) {
    super(message, 'TOOL_EXECUTION_ERROR', false, cause);
    this.name = 'ToolExecutionError';
  }
}

export class LarkAPIError extends LarkBotError {
  constructor(message: string, cause?: Error) {
    super(message, 'LARK_API_ERROR', true, cause);
    this.name = 'LarkAPIError';
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
