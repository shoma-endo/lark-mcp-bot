import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageProcessor } from '../src/bot/message-processor.js';
import type { IntentPlannerLike } from '../src/bot/intent-planner.js';

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
  let mockIntentPlanner: IntentPlannerLike;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIntentPlanner = {
      createPlan: vi.fn((userText: string) => ({
        normalizedUserText: userText,
        slotHints: { confidence: 0 },
      })),
    };
    processor = new MessageProcessor(mockLLMService, mockToolExecutor, mockStorage, mockIntentPlanner);
  });

  afterEach(() => {
    delete process.env.DEFAULT_USER_ID;
    delete process.env.DEFAULT_OPEN_ID;
    delete process.env.DEFAULT_UNION_ID;
    delete process.env.DEFAULT_USER_EMAIL;
    delete process.env.DEFAULT_USER_MOBILE;
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

  it('should process group chat with Lark <at> mention format', async () => {
    const event: any = {
      message: {
        content: JSON.stringify({ text: '<at user_id="ou_xxx">Bot</at> Hello' }),
        chat_type: 'group',
        message_id: 'msg123-at'
      },
      sender: { sender_id: { user_id: 'user123' } }
    };

    const result = await processor.process(event);
    expect(result).toBe('Bot response');
    expect(mockLLMService.createCompletion).toHaveBeenCalled();
  });

  it('should process group post message with structured at tag mention', async () => {
    const event: any = {
      message: {
        content: JSON.stringify({
          zh_cn: {
            title: '',
            content: [[
              { tag: 'at', user_id: 'ou_xxx', user_name: 'Bot' },
              { tag: 'text', text: ' 手伝って' }
            ]]
          }
        }),
        chat_type: 'group',
        message_id: 'msg123-post'
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

    it('should normalize malformed tool argument string into object', async () => {
      mockLLMService.createCompletion
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-legacy',
                type: 'function',
                function: {
                  name: 'calendar.v4.freebusy.list',
                  arguments: '<tool_call>calendar.v4.freebusy.list:time_min=2025-02-18T00:00:00+09:00:time_max=2025-02-25T00:00:00+09:00:user_ids=me:</arg_value>'
                }
              }]
            }
          }]
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: '予定を確認しました。'
            }
          }]
        });

      mockToolExecutor.executeToolCall.mockResolvedValueOnce('{"ok": true}');

      const event: any = {
        message: {
          content: JSON.stringify({ text: '予定を確認して' }),
          chat_type: 'p2p',
          message_id: 'msg133'
        },
        sender: { sender_id: { user_id: 'user123' } }
      };

      await processor.process(event);

      expect(mockToolExecutor.executeToolCall).toHaveBeenCalledWith('calendar.v4.freebusy.list', {
        time_min: '2025-02-18T00:00:00+09:00',
        time_max: '2025-02-25T00:00:00+09:00',
        user_ids: ['user123'],
        user_id: 'user123',
        user_id_type: 'user_id',
      });
    });

    it('should normalize arg_key/arg_value style tool arguments', async () => {
      mockLLMService.createCompletion
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-tagged',
                type: 'function',
                function: {
                  name: 'calendar.v4.freebusy.list',
                  arguments: '<tool_call>calendar.v4.freebusy.list<arg_key>time_max</arg_key><arg_value>2025-02-26T00:00:00+08:00\"</arg_value><arg_key>time_min</arg_key><arg_value>2025-02-19T00:00:00+08:00\"</arg_value><arg_key>user_ids</arg_key><arg_value>[\"me\"]</arg_value></tool_call>'
                }
              }]
            }
          }]
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: '予定を確認しました。'
            }
          }]
        });

      mockToolExecutor.executeToolCall.mockResolvedValueOnce('{"ok": true}');

      const event: any = {
        message: {
          content: JSON.stringify({ text: '予定を確認して' }),
          chat_type: 'p2p',
          message_id: 'msg134'
        },
        sender: { sender_id: { user_id: 'user123' } }
      };

      await processor.process(event);

      expect(mockToolExecutor.executeToolCall).toHaveBeenCalledWith('calendar.v4.freebusy.list', {
        time_max: '2025-02-26T00:00:00+08:00',
        time_min: '2025-02-19T00:00:00+08:00',
        user_ids: ['user123'],
        user_id: 'user123',
        user_id_type: 'user_id',
      });
    });

    it('should prefer fixed user identity from environment variables', async () => {
      process.env.DEFAULT_USER_ID = 'env-user-999';

      mockLLMService.createCompletion
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-env-fixed',
                type: 'function',
                function: {
                  name: 'calendar.v4.freebusy.list',
                  arguments: JSON.stringify({
                    time_min: '2025-02-20T00:00:00+09:00',
                    time_max: '2025-02-21T00:00:00+09:00',
                    user_ids: ['me'],
                  }),
                }
              }]
            }
          }]
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'OK' } }]
        });

      mockToolExecutor.executeToolCall.mockResolvedValueOnce('{"ok": true}');

      const event: any = {
        message: {
          content: JSON.stringify({ text: '予定を確認して' }),
          chat_type: 'p2p',
          message_id: 'msg135'
        },
        sender: { sender_id: { user_id: 'sender-user-123' } }
      };

      await processor.process(event);

      expect(mockToolExecutor.executeToolCall).toHaveBeenCalledWith('calendar.v4.freebusy.list', {
        time_min: '2025-02-20T00:00:00+09:00',
        time_max: '2025-02-21T00:00:00+09:00',
        user_ids: ['env-user-999'],
        user_id: 'env-user-999',
        user_id_type: 'user_id',
      });
    });

    it('should auto-resolve me placeholders for non-calendar tools too', async () => {
      process.env.DEFAULT_USER_ID = 'env-user-001';
      process.env.DEFAULT_USER_EMAIL = 'user@example.com';
      process.env.DEFAULT_USER_MOBILE = '+819000000000';

      mockLLMService.createCompletion
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-generic-identity',
                type: 'function',
                function: {
                  name: 'contact.v3.user.get',
                  arguments: JSON.stringify({
                    user_id: 'me',
                    email: 'me',
                    mobile: 'me',
                  }),
                }
              }]
            }
          }]
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'OK' } }]
        });

      mockToolExecutor.executeToolCall.mockResolvedValueOnce('{"ok": true}');

      const event: any = {
        message: {
          content: JSON.stringify({ text: 'ユーザー情報' }),
          chat_type: 'p2p',
          message_id: 'msg136'
        },
        sender: { sender_id: { user_id: 'sender-user-123' } }
      };

      await processor.process(event);

      expect(mockToolExecutor.executeToolCall).toHaveBeenCalledWith('contact.v3.user.get', {
        user_id: 'env-user-001',
        email: 'user@example.com',
        mobile: '+819000000000',
      });
    });

    it('should fill missing freebusy time range from planner hints', async () => {
      (mockIntentPlanner.createPlan as ReturnType<typeof vi.fn>).mockReturnValue({
        normalizedUserText: '来週の空き',
        slotHints: {
          intent: 'calendar_freebusy',
          timeMin: '2025-02-24T00:00:00+09:00',
          timeMax: '2025-03-03T00:00:00+09:00',
          confidence: 0.9,
        },
      });

      mockLLMService.createCompletion
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-freebusy-no-time',
                type: 'function',
                function: {
                  name: 'calendar.v4.freebusy.list',
                  arguments: JSON.stringify({ user_ids: ['me'] })
                }
              }]
            }
          }]
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'OK' } }]
        });

      mockToolExecutor.executeToolCall.mockResolvedValueOnce('{"ok": true}');

      const event: any = {
        message: {
          content: JSON.stringify({ text: '来週空いてる？' }),
          chat_type: 'p2p',
          message_id: 'msg137'
        },
        sender: { sender_id: { user_id: 'user123' } }
      };

      await processor.process(event);

      expect(mockToolExecutor.executeToolCall).toHaveBeenCalledWith('calendar.v4.freebusy.list', {
        user_ids: ['user123'],
        user_id: 'user123',
        user_id_type: 'user_id',
        time_min: '2025-02-24T00:00:00+09:00',
        time_max: '2025-03-03T00:00:00+09:00',
      });
    });
  });
});
