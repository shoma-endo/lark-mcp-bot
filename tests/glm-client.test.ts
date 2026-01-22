import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock environment variables
vi.stubEnv('LARK_APP_ID', 'test-app-id');
vi.stubEnv('LARK_APP_SECRET', 'test-app-secret');
vi.stubEnv('GLM_API_KEY', 'test-glm-key');

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('GLMClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('chat', () => {
    it('should send chat request with correct parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'chat-123',
          created: 1234567890,
          model: 'glm-4.7',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      const result = await client.chat([
        { role: 'user', content: 'Hi' },
      ]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.z.ai/api/paas/v4/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-glm-key',
          },
        })
      );

      expect(result.choices[0].message.content).toBe('Hello!');
    });

    it('should throw error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      await expect(client.chat([{ role: 'user', content: 'Hi' }]))
        .rejects.toThrow('GLM API error: 500 - Internal Server Error');
    });

    it('should use custom temperature and maxTokens', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'chat-123',
          created: 1234567890,
          model: 'glm-4.7',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      await client.chat(
        [{ role: 'user', content: 'Hi' }],
        { temperature: 0.5, maxTokens: 1000 }
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.temperature).toBe(0.5);
      expect(callBody.max_tokens).toBe(1000);
    });
  });

  describe('chatSimple', () => {
    it('should send simple prompt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'chat-123',
          created: 1234567890,
          model: 'glm-4.7',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Simple response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      const result = await client.chatSimple('Hello');

      expect(result).toBe('Simple response');
    });

    it('should include system prompt when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'chat-123',
          created: 1234567890,
          model: 'glm-4.7',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      await client.chatSimple('Hello', 'You are a helpful assistant');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.messages).toHaveLength(2);
      expect(callBody.messages[0].role).toBe('system');
      expect(callBody.messages[0].content).toBe('You are a helpful assistant');
    });

    it('should return empty string when no content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'chat-123',
          created: 1234567890,
          model: 'glm-4.7',
          choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      const result = await client.chatSimple('Hello');

      expect(result).toBe('');
    });
  });

  describe('analyzeIntent', () => {
    it('should parse intent from JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'chat-123',
          created: 1234567890,
          model: 'glm-4.7',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                intent: 'message_search',
                confidence: 0.9,
                entities: { keyword: 'project' },
              }),
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      const result = await client.analyzeIntent('Search for project messages');

      expect(result.intent).toBe('message_search');
      expect(result.confidence).toBe(0.9);
      expect(result.entities.keyword).toBe('project');
    });

    it('should return fallback on invalid JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'chat-123',
          created: 1234567890,
          model: 'glm-4.7',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Not JSON' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      const result = await client.analyzeIntent('Random text');

      expect(result.intent).toBe('other');
      expect(result.confidence).toBe(0.5);
      expect(result.entities).toEqual({});
    });
  });

  describe('generateBotResponse', () => {
    it('should generate response with chat history', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'chat-123',
          created: 1234567890,
          model: 'glm-4.7',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Generated response' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      const result = await client.generateBotResponse('New message', {
        chatHistory: [
          { role: 'user', content: 'Previous message' },
          { role: 'assistant', content: 'Previous response' },
        ],
      });

      expect(result).toBe('Generated response');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      // System + 2 history + 1 new = 4 messages
      expect(callBody.messages.length).toBe(4);
    });

    it('should limit chat history to last 10 messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'chat-123',
          created: 1234567890,
          model: 'glm-4.7',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      const history = Array(15).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: `Message ${i}`,
      }));

      await client.generateBotResponse('New message', { chatHistory: history });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      // System + 10 history + 1 new = 12 messages
      expect(callBody.messages.length).toBe(12);
    });

    it('should return fallback on empty response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'chat-123',
          created: 1234567890,
          model: 'glm-4.7',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: null },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      const result = await client.generateBotResponse('Hello');

      expect(result).toBe('申し訳ありませんが、応答を生成できませんでした。');
    });
  });

  describe('chatStream', () => {
    it('should stream chat responses', async () => {
      // Create a mock ReadableStream
      const encoder = new TextEncoder();
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      let chunkIndex = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (chunkIndex < chunks.length) {
            const value = encoder.encode(chunks[chunkIndex]);
            chunkIndex++;
            return Promise.resolve({ done: false, value });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      const results: string[] = [];
      for await (const chunk of client.chatStream([{ role: 'user', content: 'Hi' }])) {
        results.push(chunk);
      }

      expect(results).toEqual(['Hello', ' world']);
    });

    it('should throw error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limit exceeded'),
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      await expect(async () => {
        for await (const _ of client.chatStream([{ role: 'user', content: 'Hi' }])) {
          // consume iterator
        }
      }).rejects.toThrow('GLM API error: 429 - Rate limit exceeded');
    });

    it('should throw error when no response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: null,
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      await expect(async () => {
        for await (const _ of client.chatStream([{ role: 'user', content: 'Hi' }])) {
          // consume iterator
        }
      }).rejects.toThrow('No response body');
    });

    it('should handle incomplete JSON lines gracefully', async () => {
      const encoder = new TextEncoder();
      // Simulate a chunk with incomplete data
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Part1"}}]}\n',
        '\ndata: invalid-json\n\n',
        'data: {"choices":[{"delta":{"content":"Part2"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      let chunkIndex = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (chunkIndex < chunks.length) {
            const value = encoder.encode(chunks[chunkIndex]);
            chunkIndex++;
            return Promise.resolve({ done: false, value });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      const results: string[] = [];
      for await (const chunk of client.chatStream([{ role: 'user', content: 'Hi' }])) {
        results.push(chunk);
      }

      // Should skip invalid JSON and continue
      expect(results).toEqual(['Part1', 'Part2']);
    });

    it('should handle chunks without content', async () => {
      const encoder = new TextEncoder();
      const chunks = [
        'data: {"choices":[{"delta":{}}]}\n\n', // No content
        'data: {"choices":[{"delta":{"content":"Real content"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      let chunkIndex = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (chunkIndex < chunks.length) {
            const value = encoder.encode(chunks[chunkIndex]);
            chunkIndex++;
            return Promise.resolve({ done: false, value });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      });

      const { GLMClient } = await import('../src/glm/client.js');
      const client = new GLMClient();

      const results: string[] = [];
      for await (const chunk of client.chatStream([{ role: 'user', content: 'Hi' }])) {
        results.push(chunk);
      }

      // Should only yield chunks with content
      expect(results).toEqual(['Real content']);
    });
  });
});
