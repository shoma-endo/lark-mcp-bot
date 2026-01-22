import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock environment variables before importing config
vi.stubEnv('LARK_APP_ID', 'test-app-id');
vi.stubEnv('LARK_APP_SECRET', 'test-app-secret');
vi.stubEnv('GLM_API_KEY', 'test-glm-key');
vi.stubEnv('PORT', '3000');

// Mock the external dependencies
vi.mock('@larksuiteoapi/node-sdk', () => {
  const mockClient = {
    im: {
      message: {
        create: vi.fn().mockResolvedValue({ data: { message_id: 'msg123' } }),
      },
    },
  };

  const mockEventDispatcher = vi.fn().mockImplementation(() => ({
    register: vi.fn(),
  }));

  return {
    Client: vi.fn().mockImplementation(() => mockClient),
    EventDispatcher: mockEventDispatcher,
    LoggerLevel: { info: 1 },
  };
});

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: 'Test response',
                tool_calls: null,
              },
            }],
          }),
        },
      },
    })),
  };
});

vi.mock('@larksuiteoapi/lark-mcp/dist/mcp-tool/mcp-tool.js', () => {
  return {
    LarkMcpTool: vi.fn().mockImplementation(() => ({
      getTools: vi.fn().mockReturnValue([
        {
          name: 'lark_send_message',
          description: 'Send a message',
          schema: {
            type: 'object',
            properties: { chat_id: { type: 'string' }, text: { type: 'string' } },
            required: ['chat_id', 'text'],
          },
        },
      ]),
    })),
  };
});

vi.mock('@larksuiteoapi/lark-mcp/dist/mcp-tool/utils/index.js', () => {
  return {
    larkOapiHandler: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Message sent' }],
      isError: false,
    }),
  };
});

describe('LarkMCPBot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should initialize with correct configuration', async () => {
    const { LarkMCPBot } = await import('../src/bot/index.js');
    const bot = new LarkMCPBot();

    expect(bot.larkClient).toBeDefined();
    expect(bot.openai).toBeDefined();
    expect(bot.mcpTool).toBeDefined();
  });

  it('should convert MCP tools to function definitions', async () => {
    const { LarkMCPBot } = await import('../src/bot/index.js');
    const bot = new LarkMCPBot();

    // Access private method via type assertion
    const functionDefs = (bot as any).functionDefinitions;
    expect(functionDefs).toHaveLength(1);
    expect(functionDefs[0].type).toBe('function');
    expect(functionDefs[0].function.name).toBe('lark_send_message');
  });

  it('should get event dispatcher', async () => {
    const { LarkMCPBot } = await import('../src/bot/index.js');
    const bot = new LarkMCPBot();

    const dispatcher = bot.getEventDispatcher();
    expect(dispatcher).toBeDefined();
  });

  describe('Conversation Management', () => {
    it('should initialize empty conversations map', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const conversations = (bot as any).conversations;
      expect(conversations.size).toBe(0);
    });

    it('should cleanup expired conversations', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      // Add a conversation with old timestamp
      const conversations = (bot as any).conversations;
      const timestamps = (bot as any).conversationTimestamps;
      const ttl = (bot as any).CONVERSATION_TTL_MS;

      conversations.set('old-chat', [{ role: 'user', content: 'old message' }]);
      timestamps.set('old-chat', Date.now() - ttl - 1000); // Expired

      conversations.set('new-chat', [{ role: 'user', content: 'new message' }]);
      timestamps.set('new-chat', Date.now()); // Not expired

      // Trigger cleanup
      (bot as any).cleanupExpiredConversations();

      expect(conversations.has('old-chat')).toBe(false);
      expect(conversations.has('new-chat')).toBe(true);
    });

    it('should enforce max conversations limit', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const conversations = (bot as any).conversations;
      const timestamps = (bot as any).conversationTimestamps;
      const maxConversations = (bot as any).MAX_CONVERSATIONS;

      // Add more than max conversations
      for (let i = 0; i <= maxConversations + 10; i++) {
        conversations.set(`chat-${i}`, []);
        timestamps.set(`chat-${i}`, Date.now() - i); // Earlier chats have lower timestamps
      }

      // Trigger cleanup
      (bot as any).cleanupExpiredConversations();

      expect(conversations.size).toBeLessThanOrEqual(maxConversations);
    });
  });

  describe('Logging', () => {
    it('should log structured messages', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      (bot as any).log('info', 'Test message', { chatId: 'test-chat' });

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(logOutput.message).toBe('Test message');
      expect(logOutput.level).toBe('info');
      expect(logOutput.chatId).toBe('test-chat');

      consoleSpy.mockRestore();
    });

    it('should log errors with stack trace', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const testError = new Error('Test error');

      (bot as any).log('error', 'Error occurred', {}, testError);

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(logOutput.error.name).toBe('Error');
      expect(logOutput.error.message).toBe('Test error');

      consoleSpy.mockRestore();
    });

    it('should log warnings', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      (bot as any).log('warn', 'Warning message', { chatId: 'test-chat' });

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(logOutput.level).toBe('warn');

      consoleSpy.mockRestore();
    });
  });

  describe('Tool Execution', () => {
    it('should execute tool successfully', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await (bot as any).executeToolCall('lark_send_message', {
        chat_id: 'test-chat',
        text: 'Hello',
      });

      expect(result).toBe('Message sent');

      consoleSpy.mockRestore();
    });

    it('should handle tool not found', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await (bot as any).executeToolCall('unknown_tool', {});

      expect(result).toContain('Error');
      expect(result).toContain('not found');

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should handle tool execution error', async () => {
      const { larkOapiHandler } = await import('@larksuiteoapi/lark-mcp/dist/mcp-tool/utils/index.js');
      (larkOapiHandler as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Error details' }],
        isError: true,
      });

      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await (bot as any).executeToolCall('lark_send_message', {
        chat_id: 'test-chat',
        text: 'Hello',
      });

      expect(result).toContain('Error');

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('Message Handling', () => {
    it('should handle message without tool calls', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const messageEvent = {
        message: {
          message_id: 'msg-123',
          chat_id: 'chat-123',
          content: JSON.stringify({ text: 'Hello bot' }),
          message_type: 'text',
        },
        sender: {
          sender_id: {
            user_id: 'user-123',
            open_id: 'open-123',
            union_id: 'union-123',
          },
          sender_type: 'user',
        },
      };

      await (bot as any).handleMessageReceive(messageEvent);

      // Verify conversation was stored
      const conversations = (bot as any).conversations;
      expect(conversations.has('chat-123')).toBe(true);

      // Verify message was sent
      expect(bot.larkClient.im.message.create).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should skip empty messages', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const messageEvent = {
        message: {
          message_id: 'msg-123',
          chat_id: 'chat-123',
          content: JSON.stringify({ text: '' }),
          message_type: 'text',
        },
        sender: {
          sender_id: {
            user_id: 'user-123',
          },
        },
      };

      await (bot as any).handleMessageReceive(messageEvent);

      // Verify message was NOT sent (empty message)
      expect(bot.larkClient.im.message.create).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle message with tool calls', async () => {
      const OpenAI = (await import('openai')).default;
      const mockOpenAI = new OpenAI({ apiKey: 'test' });

      // First call returns tool calls
      (mockOpenAI.chat.completions.create as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-123',
                type: 'function',
                function: {
                  name: 'lark_send_message',
                  arguments: JSON.stringify({ chat_id: 'target-chat', text: 'Hello' }),
                },
              }],
            },
          }],
        })
        // Second call returns final response
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: 'I sent the message for you.',
              tool_calls: null,
            },
          }],
        });

      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();
      (bot as any).openai = mockOpenAI;

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const messageEvent = {
        message: {
          message_id: 'msg-123',
          chat_id: 'chat-123',
          content: JSON.stringify({ text: 'Send a message to target-chat' }),
          message_type: 'text',
        },
        sender: {
          sender_id: {
            user_id: 'user-123',
          },
        },
      };

      await (bot as any).handleMessageReceive(messageEvent);

      // Verify OpenAI was called twice (initial + follow-up)
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
    });

    it('should handle errors and send error message', async () => {
      const OpenAI = (await import('openai')).default;
      const mockOpenAI = new OpenAI({ apiKey: 'test' });

      (mockOpenAI.chat.completions.create as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('API Error'));

      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();
      (bot as any).openai = mockOpenAI;

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const messageEvent = {
        message: {
          message_id: 'msg-123',
          chat_id: 'chat-123',
          content: JSON.stringify({ text: 'Hello' }),
          message_type: 'text',
        },
        sender: {
          sender_id: {
            user_id: 'user-123',
          },
        },
      };

      await (bot as any).handleMessageReceive(messageEvent);

      // Verify error message was sent
      expect(bot.larkClient.im.message.create).toHaveBeenCalled();
      const lastCall = (bot.larkClient.im.message.create as ReturnType<typeof vi.fn>).mock.calls[0];
      const content = JSON.parse(lastCall[0].data.content);
      expect(content.text).toContain('エラー');

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should remove @mentions from message text', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const messageEvent = {
        message: {
          message_id: 'msg-123',
          chat_id: 'chat-123',
          content: JSON.stringify({ text: '@_user_123 Hello bot' }),
          message_type: 'text',
        },
        sender: {
          sender_id: {
            user_id: 'user-123',
          },
        },
      };

      await (bot as any).handleMessageReceive(messageEvent);

      // Verify conversation has cleaned text
      const conversations = (bot as any).conversations;
      const history = conversations.get('chat-123');
      expect(history[0].content).toBe('Hello bot');

      consoleSpy.mockRestore();
    });

    it('should handle non-JSON message content', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const messageEvent = {
        message: {
          message_id: 'msg-123',
          chat_id: 'chat-123',
          content: 'Plain text message', // Not JSON
          message_type: 'text',
        },
        sender: {
          sender_id: {
            user_id: 'user-123',
          },
        },
      };

      await (bot as any).handleMessageReceive(messageEvent);

      // Verify conversation has the plain text
      const conversations = (bot as any).conversations;
      const history = conversations.get('chat-123');
      expect(history[0].content).toBe('Plain text message');

      consoleSpy.mockRestore();
    });
  });

  describe('Message Retry', () => {
    it('should retry on failure', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // First call fails, second succeeds
      (bot.larkClient.im.message.create as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ data: { message_id: 'msg-new' } });

      await (bot as any).sendMessageWithRetry('chat-123', 'Hello', { chatId: 'chat-123' });

      // Should have been called twice (1 failure + 1 success)
      expect(bot.larkClient.im.message.create).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('should throw after max retries', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const { LarkAPIError } = await import('../src/types.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // All calls fail
      (bot.larkClient.im.message.create as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('Network error'));

      await expect(
        (bot as any).sendMessageWithRetry('chat-123', 'Hello', { chatId: 'chat-123' }, 2)
      ).rejects.toThrow(LarkAPIError);

      // Should have been called twice
      expect(bot.larkClient.im.message.create).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe('History Management', () => {
    it('should trim history to 20 messages without tool calls', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Pre-populate with 25 messages
      const conversations = (bot as any).conversations;
      const timestamps = (bot as any).conversationTimestamps;
      const history: any[] = [];
      for (let i = 0; i < 25; i++) {
        history.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` });
      }
      conversations.set('chat-123', history);
      timestamps.set('chat-123', Date.now());

      // Reset mock to ensure success
      (bot.larkClient.im.message.create as ReturnType<typeof vi.fn>)
        .mockResolvedValue({ data: { message_id: 'msg-new' } });

      const messageEvent = {
        message: {
          message_id: 'msg-123',
          chat_id: 'chat-123',
          content: JSON.stringify({ text: 'New message' }),
          message_type: 'text',
        },
        sender: {
          sender_id: {
            user_id: 'user-123',
          },
        },
      };

      await (bot as any).handleMessageReceive(messageEvent);

      // History should be trimmed (25 + 1 user + 1 assistant = 27, then trimmed to 20)
      const updatedHistory = conversations.get('chat-123');
      expect(updatedHistory.length).toBeLessThanOrEqual(20);

      consoleSpy.mockRestore();
    });
  });
});
