import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock environment variables before importing config
vi.stubEnv('LARK_APP_ID', 'test-app-id');
vi.stubEnv('LARK_APP_SECRET', 'test-app-secret');
vi.stubEnv('GLM_API_KEY', 'test-glm-key');
vi.stubEnv('PORT', '3000');

// Mock external dependencies
vi.mock('@larksuiteoapi/node-sdk', () => {
  const mockClient = {
    im: {
      message: {
        create: vi.fn().mockResolvedValue({ data: { message_id: 'msg123' } }),
      },
      chat: {
        list: vi.fn().mockResolvedValue({
          data: {
            items: [
              { chat_id: 'chat1', name: 'Test Chat 1' },
              { chat_id: 'chat2', name: 'Test Chat 2' },
            ],
          },
        }),
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
            choices: [
              {
                message: {
                  content: 'Test response',
                  tool_calls: null,
                },
              },
            ],
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
        {
          name: 'im.chat.list',
          description: 'List chats',
          schema: {
            type: 'object',
            properties: { page_size: { type: 'number' } },
            required: [],
          },
        },
      ]),
    })),
  };
});

vi.mock('@larksuiteoapi/lark-mcp/dist/mcp-tool/utils/index.js', () => {
  return {
    larkOapiHandler: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Operation successful' }],
      isError: false,
    }),
  };
});

describe('LarkMCPBot Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('End-to-End Message Flow', () => {
    it('should handle user mention without tool calls', async () => {
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

      // Verify the message content is appropriate
      const sentMessage = bot.larkClient.im.message.create as ReturnType<typeof vi.fn>;
      const lastCall = sentMessage.mock.calls[0][0];
      const content = JSON.parse(lastCall.data.content);
      expect(content.text).toBeTruthy();

      consoleSpy.mockRestore();
    });

    it('should handle user mention with tool calls', async () => {
      const OpenAI = (await import('openai')).default;
      const mockOpenAI = new OpenAI({ apiKey: 'test' });

      const mockCreate = mockOpenAI.chat.completions.create as ReturnType<typeof vi.fn>;
      
      // First call returns tool calls
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call-123',
                  type: 'function',
                  function: {
                    name: 'im.chat.list',
                    arguments: JSON.stringify({ page_size: 10 }),
                  },
                },
              ],
            },
          },
        ],
      });
      
      // Second call returns final response
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'I found 2 chats: Test Chat 1 and Test Chat 2',
              tool_calls: null,
            },
          },
        ],
      });

      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();
      (bot as any).openai = mockOpenAI;

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const messageEvent = {
        message: {
          message_id: 'msg-123',
          chat_id: 'chat-123',
          content: JSON.stringify({ text: 'Show me the chat list' }),
          message_type: 'text',
        },
        sender: {
          sender_id: {
            user_id: 'user-123',
          },
          sender_type: 'user',
        },
      };

      await (bot as any).handleMessageReceive(messageEvent);

      // Verify OpenAI was called twice (initial + follow-up)
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(2);

      // Verify message was sent with final response
      expect(bot.larkClient.im.message.create).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should maintain conversation context across messages', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const conversations = (bot as any).conversations;
      const timestamps = (bot as any).conversationTimestamps;

      // First message
      const messageEvent1 = {
        message: {
          message_id: 'msg-1',
          chat_id: 'chat-123',
          content: JSON.stringify({ text: 'First message' }),
          message_type: 'text',
        },
        sender: {
          sender_id: { user_id: 'user-123' },
        },
      };

      await (bot as any).handleMessageReceive(messageEvent1);

      const history1 = conversations.get('chat-123');
      expect(history1.length).toBeGreaterThanOrEqual(2); // At least user + assistant message
      const history1Length = history1.length;

      // Second message
      const messageEvent2 = {
        message: {
          message_id: 'msg-2',
          chat_id: 'chat-123',
          content: JSON.stringify({ text: 'Second message' }),
          message_type: 'text',
        },
        sender: {
          sender_id: { user_id: 'user-123' },
        },
      };

      await (bot as any).handleMessageReceive(messageEvent2);

      const history2 = conversations.get('chat-123');
      expect(history2.length).toBeGreaterThan(history1Length);

      // Verify timestamp was updated
      expect(timestamps.get('chat-123')).toBeGreaterThan(0);

      consoleSpy.mockRestore();
    });

    it('should handle multiple conversations independently', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const conversations = (bot as any).conversations;

      // Chat 1
      const messageEvent1 = {
        message: {
          message_id: 'msg-1',
          chat_id: 'chat-1',
          content: JSON.stringify({ text: 'Message in chat 1' }),
          message_type: 'text',
        },
        sender: {
          sender_id: { user_id: 'user-1' },
        },
      };

      await (bot as any).handleMessageReceive(messageEvent1);

      // Chat 2
      const messageEvent2 = {
        message: {
          message_id: 'msg-2',
          chat_id: 'chat-2',
          content: JSON.stringify({ text: 'Message in chat 2' }),
          message_type: 'text',
        },
        sender: {
          sender_id: { user_id: 'user-2' },
        },
      };

      await (bot as any).handleMessageReceive(messageEvent2);

      // Verify both conversations exist independently
      expect(conversations.has('chat-1')).toBe(true);
      expect(conversations.has('chat-2')).toBe(true);

      const history1 = conversations.get('chat-1');
      const history2 = conversations.get('chat-2');

      // Verify histories are independent - check user messages
      const userMessage1 = history1.find((msg: any) => msg.role === 'user');
      const userMessage2 = history2.find((msg: any) => msg.role === 'user');
      
      expect(userMessage1.content).toContain('chat 1');
      expect(userMessage2.content).toContain('chat 2');

      consoleSpy.mockRestore();
    });
  });

  describe('Error Scenarios', () => {
    it('should handle GLM API errors gracefully', async () => {
      const OpenAI = (await import('openai')).default;
      const mockOpenAI = new OpenAI({ apiKey: 'test' });

      (mockOpenAI.chat.completions.create as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('GLM API Error: 429 - Rate limit exceeded'));

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
          sender_id: { user_id: 'user-123' },
        },
      };

      await (bot as any).handleMessageReceive(messageEvent);

      // Verify error was logged
      expect(errorSpy).toHaveBeenCalled();

      // Verify user-friendly error message was sent
      expect(bot.larkClient.im.message.create).toHaveBeenCalled();
      const lastCall = (bot.larkClient.im.message.create as ReturnType<typeof vi.fn>).mock.calls[0];
      const content = JSON.parse(lastCall[0].data.content);
      expect(content.text).toContain('エラー');

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should handle Lark API errors gracefully', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      // Mock Lark API to fail
      (bot.larkClient.im.message.create as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('Lark API: Unauthorized'));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        await (bot as any).sendMessageWithRetry('chat-123', 'Hello', { chatId: 'chat-123' }, 2);
      } catch (error) {
        // Expected to throw after retries
      }

      // Verify retry attempts
      expect(bot.larkClient.im.message.create).toHaveBeenCalledTimes(2);

      // Verify warning was logged for retry attempts
      expect(warnSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('should handle MCP tool execution errors', async () => {
      const { larkOapiHandler } = await import('@larksuiteoapi/lark-mcp/dist/mcp-tool/utils/index.js');

      // Mock tool execution to fail
      (larkOapiHandler as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Tool execution failed' }],
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

      // Verify result contains error information
      expect(result).toContain('Error');

      // Verify error was logged
      expect(errorSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should handle malformed JSON in message content', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      // Ensure Lark API returns 401 error for all calls
      (bot.larkClient.im.message.create as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('Lark API: Unauthorized'));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const messageEvent = {
        message: {
          message_id: 'msg-123',
          chat_id: 'chat-123',
          content: 'Invalid { JSON', // Not valid JSON
          message_type: 'text',
        },
        sender: {
          sender_id: { user_id: 'user-123' },
        },
      };

      await (bot as any).handleMessageReceive(messageEvent);

      // Verify conversation was stored with plain text
      const conversations = (bot as any).conversations;
      const history = conversations.get('chat-123');
      expect(history).toBeDefined();
      
      // Find the user message in the history
      const userMessage = history.find((msg: any) => msg.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage.content).toBe('Invalid { JSON');

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }, 10000); // Set timeout to 10s to account for retries
  });

  describe('Performance and Limits', () => {
    it('should enforce message history limit', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      // Ensure Lark API returns 401 error for all calls
      (bot.larkClient.im.message.create as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('Lark API: Unauthorized'));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Pre-populate with 30 messages (near limit)
      const conversations = (bot as any).conversations;
      const timestamps = (bot as any).conversationTimestamps;
      const history: any[] = [];
      for (let i = 0; i < 30; i++) {
        history.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` });
      }
      conversations.set('chat-123', history);
      timestamps.set('chat-123', Date.now());

      // Send another message
      const messageEvent = {
        message: {
          message_id: 'msg-new',
          chat_id: 'chat-123',
          content: JSON.stringify({ text: 'New message' }),
          message_type: 'text',
        },
        sender: {
          sender_id: { user_id: 'user-123' },
        },
      };

      await (bot as any).handleMessageReceive(messageEvent);

      // Verify history was trimmed
      const updatedHistory = conversations.get('chat-123');
      expect(updatedHistory.length).toBeLessThanOrEqual(30);

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }, 10000); // Set timeout to 10s to account for retries

    it('should cleanup expired conversations', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const conversations = (bot as any).conversations;
      const timestamps = (bot as any).conversationTimestamps;
      const ttl = (bot as any).CONVERSATION_TTL_MS;

      // Add expired conversation
      conversations.set('expired-chat', [{ role: 'user', content: 'old message' }]);
      timestamps.set('expired-chat', Date.now() - ttl - 1000);

      // Add active conversation
      conversations.set('active-chat', [{ role: 'user', content: 'new message' }]);
      timestamps.set('active-chat', Date.now());

      // Trigger cleanup
      await (bot as any).cleanupExpiredConversations();

      // Verify expired conversation was removed
      expect(conversations.has('expired-chat')).toBe(false);
      expect(conversations.has('active-chat')).toBe(true);
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
        timestamps.set(`chat-${i}`, Date.now() - i * 1000);
      }

      // Trigger cleanup
      await (bot as any).cleanupExpiredConversations();

      // Verify limit was enforced
      expect(conversations.size).toBeLessThanOrEqual(maxConversations);
    });
  });
});
