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

    // Access private functionDefinitions
    const functionDefs = (bot as any).functionDefinitions;
    
    // Function definitions should be generated from MCP tools
    expect(Array.isArray(functionDefs)).toBe(true);
    
    // Each function definition should have correct structure if any exist
    functionDefs.forEach((def: any) => {
      expect(def.type).toBe('function');
      expect(def.function).toBeDefined();
      expect(def.function.name).toBeDefined();
      expect(def.function.description).toBeDefined();
      expect(def.function.parameters).toBeDefined();
    });
  });

  it('should get event dispatcher', async () => {
    const { LarkMCPBot } = await import('../src/bot/index.js');
    const bot = new LarkMCPBot();

    const dispatcher = bot.getEventDispatcher();
    expect(dispatcher).toBeDefined();
  });

  describe('Conversation Management', () => {
    it('should initialize with storage', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const storage = bot.getStorage();
      expect(storage).toBeDefined();
      
      // Should start with no conversations
      const chatIds = await storage.getAllChatIds();
      expect(chatIds.length).toBe(0);
    });

    it('should cleanup expired conversations', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const storage = bot.getStorage();
      const ttl = (bot as any).CONVERSATION_TTL_MS;

      // Add expired conversation
      await storage.setHistory('old-chat', [{ role: 'user', content: 'old message' }]);
      await storage.setTimestamp('old-chat', Date.now() - ttl - 1000);

      // Add active conversation
      await storage.setHistory('new-chat', [{ role: 'user', content: 'new message' }]);
      await storage.setTimestamp('new-chat', Date.now());

      // Trigger cleanup
      await (bot as any).cleanupExpiredConversations();

      // Verify expired conversation was removed
      const oldHistory = await storage.getHistory('old-chat');
      const newHistory = await storage.getHistory('new-chat');
      
      expect(oldHistory.length).toBe(0);
      expect(newHistory.length).toBeGreaterThan(0);
    });

    it('should store and retrieve conversation history', async () => {
      const { LarkMCPBot } = await import('../src/bot/index.js');
      const bot = new LarkMCPBot();

      const storage = bot.getStorage();

      // Add conversation
      const testHistory = [
        { role: 'user' as const, content: 'Test 1' },
        { role: 'assistant' as const, content: 'Response 1' },
      ];
      
      await storage.setHistory('test-chat', testHistory);

      // Retrieve and verify
      const retrieved = await storage.getHistory('test-chat');
      expect(retrieved.length).toBe(2);
      expect(retrieved[0].content).toBe('Test 1');
      expect(retrieved[1].content).toBe('Response 1');
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
      const storage = bot.getStorage();
      const history = await storage.getHistory('chat-123');
      expect(history.length).toBeGreaterThan(0);

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
      const storage = bot.getStorage();
      const history = await storage.getHistory('chat-123');
      const userMessage = history.find(msg => msg.role === 'user');
      expect(userMessage?.content).toBe('Hello bot');

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
      const storage = bot.getStorage();
      const history = await storage.getHistory('chat-123');
      const userMessage = history.find(msg => msg.role === 'user');
      expect(userMessage?.content).toBe('Plain text message');

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
      const storage = bot.getStorage();
      const history: any[] = [];
      for (let i = 0; i < 25; i++) {
        history.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` });
      }
      await storage.setHistory('chat-123', history);
      await storage.setTimestamp('chat-123', Date.now());

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
      const updatedHistory = await storage.getHistory('chat-123');
      expect(updatedHistory.length).toBeLessThanOrEqual(20);

      consoleSpy.mockRestore();
    });
  });
});
