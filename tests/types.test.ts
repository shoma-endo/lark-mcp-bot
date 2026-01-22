import { describe, it, expect } from 'vitest';
import {
  LarkBotError,
  LLMError,
  ToolExecutionError,
  LarkAPIError,
} from '../src/types.js';

describe('Custom Error Types', () => {
  describe('LarkBotError', () => {
    it('should create error with all properties', () => {
      const cause = new Error('Original error');
      const error = new LarkBotError('Test error', 'TEST_CODE', true, cause);

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.retryable).toBe(true);
      expect(error.cause).toBe(cause);
      expect(error.name).toBe('LarkBotError');
    });

    it('should default retryable to false', () => {
      const error = new LarkBotError('Test error', 'TEST_CODE');
      expect(error.retryable).toBe(false);
    });
  });

  describe('LLMError', () => {
    it('should be retryable by default', () => {
      const error = new LLMError('LLM failed');
      expect(error.retryable).toBe(true);
      expect(error.code).toBe('LLM_ERROR');
      expect(error.name).toBe('LLMError');
    });

    it('should preserve cause', () => {
      const cause = new Error('Timeout');
      const error = new LLMError('LLM failed', cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe('ToolExecutionError', () => {
    it('should store tool name', () => {
      const error = new ToolExecutionError('Tool failed', 'lark_send_message');
      expect(error.toolName).toBe('lark_send_message');
      expect(error.retryable).toBe(false);
      expect(error.code).toBe('TOOL_EXECUTION_ERROR');
      expect(error.name).toBe('ToolExecutionError');
    });
  });

  describe('LarkAPIError', () => {
    it('should be retryable by default', () => {
      const error = new LarkAPIError('API timeout');
      expect(error.retryable).toBe(true);
      expect(error.code).toBe('LARK_API_ERROR');
      expect(error.name).toBe('LarkAPIError');
    });
  });
});
