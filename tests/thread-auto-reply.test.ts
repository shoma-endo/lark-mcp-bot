import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageProcessor } from '../src/bot/message-processor.js';

// Mock dependencies
const mockLLMService: any = {
  createCompletion: vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'Bot response' } }]
  }),
};

const mockToolExecutor: any = {
  convertMcpToolsToFunctions: vi.fn().mockReturnValue([]),
  executeToolCall: vi.fn(),
  buildMutationResultLinks: vi.fn().mockReturnValue([]),
};

const mockStorage: any = {
  getHistory: vi.fn().mockResolvedValue([]),
  setTimestamp: vi.fn().mockResolvedValue(undefined),
  setHistory: vi.fn().mockResolvedValue(undefined),
};

describe('MessageProcessor - Thread Auto-Reply', () => {
  let processor: MessageProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new MessageProcessor(mockLLMService, mockToolExecutor, mockStorage);
  });

  it('should process private chat without mention', async () => {
    const event: any = {
      message: {
        content: JSON.stringify({ text: 'Hello' }),
        chat_type: 'p2p',
        message_id: 'msg123'
      },
      sender: { sender_id: { user_id: 'user123' } }
    };

    const result = await processor.process(event);
    expect(result).toBe('Bot response');
    expect(mockLLMService.createCompletion).toHaveBeenCalled();
  });

  it('should process group chat with mention', async () => {
    const event: any = {
      message: {
        content: JSON.stringify({ text: '@_user_1 Hello' }),
        chat_type: 'group',
        message_id: 'msg123'
      },
      sender: { sender_id: { user_id: 'user123' } }
    };

    const result = await processor.process(event);
    expect(result).toBe('Bot response');
    expect(mockLLMService.createCompletion).toHaveBeenCalled();
  });

  it('should process group chat without mention but with root_id (thread)', async () => {
    const event: any = {
      message: {
        content: JSON.stringify({ text: 'Continue thread' }),
        chat_type: 'group',
        message_id: 'msg124',
        root_id: 'msg123'
      },
      sender: { sender_id: { user_id: 'user123' } }
    };

    const result = await processor.process(event);
    expect(result).toBe('Bot response');
    expect(mockLLMService.createCompletion).toHaveBeenCalled();
  });

  it('should skip group chat without mention and without root_id', async () => {
    const event: any = {
      message: {
        content: JSON.stringify({ text: 'Other conversation' }),
        chat_type: 'group',
        message_id: 'msg125'
      },
      sender: { sender_id: { user_id: 'user123' } }
    };

    const result = await processor.process(event);
    expect(result).toBe('');
    expect(mockLLMService.createCompletion).not.toHaveBeenCalled();
  });

  describe('Edge Cases & Error Handling', () => {
    it('should handle malformed JSON in message content', async () => {
      const event: any = {
        message: {
          content: 'not a json',
          chat_type: 'p2p',
          message_id: 'msg126'
        },
        sender: { sender_id: { user_id: 'user123' } }
      };

      const result = await processor.process(event);
      expect(result).toBe('Bot response');
      expect(mockLLMService.createCompletion).toHaveBeenCalled();
    });

    it('should handle LLM service error', async () => {
      mockLLMService.createCompletion.mockRejectedValueOnce(new Error('LLM Error'));
      const event: any = {
        message: {
          content: JSON.stringify({ text: 'Hello' }),
          chat_type: 'p2p',
          message_id: 'msg127'
        },
        sender: { sender_id: { user_id: 'user123' } }
      };

      await expect(processor.process(event)).rejects.toThrow('LLM Error');
    });

    it('should handle storage failure (getHistory)', async () => {
      mockStorage.getHistory.mockRejectedValueOnce(new Error('Storage Error'));
      const event: any = {
        message: {
          content: JSON.stringify({ text: 'Hello' }),
          chat_type: 'p2p',
          message_id: 'msg128'
        },
        sender: { sender_id: { user_id: 'user123' } }
      };

      await expect(processor.process(event)).rejects.toThrow('Storage Error');
    });

    it('should return empty string if message text is empty', async () => {
      const event: any = {
        message: {
          content: JSON.stringify({ text: '' }),
          chat_type: 'p2p',
          message_id: 'msg129'
        },
        sender: { sender_id: { user_id: 'user123' } }
      };

      const result = await processor.process(event);
      expect(result).toBe('');
      expect(mockLLMService.createCompletion).not.toHaveBeenCalled();
    });

    it('should handle missing message content', async () => {
      const event: any = {
        message: {
          chat_type: 'p2p',
          message_id: 'msg130'
        },
        sender: { sender_id: { user_id: 'user123' } }
      };

      const result = await processor.process(event);
      expect(result).toBe('');
    });

    it('should handle missing sender info', async () => {
      const event: any = {
        message: {
          content: JSON.stringify({ text: 'Hello' }),
          chat_type: 'p2p',
          message_id: 'msg131'
        }
      };

      const result = await processor.process(event);
      expect(result).toBe('Bot response');
    });

    it('should handle tool call recursion and mutation result links', async () => {
      // Setup LLM to return a tool call first
      mockLLMService.createCompletion
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-1',
                type: 'function',
                function: {
                  name: 'test.tool.create',
                  arguments: JSON.stringify({ name: 'test' })
                }
              }]
            }
          }]
        })
        // Then return final text response after tool execution
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: 'Created successfully. Check https://example.com/result',
            }
          }]
        });

      mockToolExecutor.executeToolCall.mockResolvedValueOnce('{"id": "123"}');
      mockToolExecutor.buildMutationResultLinks.mockReturnValueOnce(['https://example.com/result']);

      const event: any = {
        message: {
          content: JSON.stringify({ text: 'Create something' }),
          chat_type: 'p2p',
          message_id: 'msg132'
        },
        sender: { sender_id: { user_id: 'user123' } }
      };

      const result = await processor.process(event);
      expect(result).toContain('Created successfully');
      expect(result).toContain('https://example.com/result');
      expect(mockLLMService.createCompletion).toHaveBeenCalledTimes(2);
      expect(mockToolExecutor.executeToolCall).toHaveBeenCalledWith('test.tool.create', { name: 'test' });
    });
  });
});
