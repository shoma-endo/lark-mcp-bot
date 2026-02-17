import { config } from '../config.js';

/**
 * GLM-4.7 API Client
 * Interfaces with Zhipu AI's GLM-4.7 model
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  thinking?: {
    type: 'enabled' | 'disabled';
  };
}

export interface ChatCompletionResponse {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class GLMClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.apiKey = config.glmApiKey;
    this.baseUrl = config.glmApiBaseUrl;
    this.model = config.glmModel;
  }

  /**
   * Send a chat completion request to GLM-4.7
   */
  async chat(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResponse> {
    const {
      model = this.model,
      temperature = 0.7,
      maxTokens = 4096,
      thinking = { type: 'enabled' },
    } = options;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        thinking,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GLM API error: ${response.status} - ${errorText}`);
    }

    return (await response.json()) as ChatCompletionResponse;
  }

  /**
   * Send a simple text prompt and get the response
   */
  async chatSimple(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: ChatMessage[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    const response = await this.chat(messages);
    return response.choices[0]?.message?.content || '';
  }

  /**
   * Stream chat completion
   */
  async *chatStream(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): AsyncGenerator<string, void, unknown> {
    const {
      model = this.model,
      temperature = 0.7,
      maxTokens = 4096,
      thinking = { type: 'enabled' },
    } = options;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        thinking,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GLM API error: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  }

  /**
   * Analyze intent from user message
   */
  async analyzeIntent(userMessage: string): Promise<{
    intent: string;
    confidence: number;
    entities: Record<string, string>;
  }> {
    const systemPrompt = `あなたはLarkボットのインテント分析エージェントです。
ユーザーメッセージから以下を分析してJSON形式で返してください：

{
  "intent": "インテント名 (message_search, document_read, bitable_query, chat_create, help, other)",
  "confidence": 0.0〜1.0の信頼度,
  "entities": {"key": "抽出されたエンティティ"}
}

インテント例:
- メッセージを探して → message_search
- ドキュメントを読んで → document_read
- データを検索して → bitable_query
- グループを作成して → chat_create
- 使い方を教えて → help`;

    const response = await this.chatSimple(userMessage, systemPrompt);
    try {
      return JSON.parse(response);
    } catch {
      return {
        intent: 'other',
        confidence: 0.5,
        entities: {},
      };
    }
  }

  /**
   * Generate response for Lark bot
   */
  async generateBotResponse(
    userMessage: string,
    context?: {
      chatHistory?: ChatMessage[];
      userInfo?: { name: string; userId: string };
    }
  ): Promise<string> {
    const systemPrompt = `あなたはLark（Feishu）のAIアシスタントボットです。

## 役割
- ユーザーの質問に日本語で親切に答えます
- Larkの機能（メッセージ、ドキュメント、Bitable、カレンダー等）を活用できます
- 分からないことは正直に分からないと伝えます

## できること
- チャット内のメッセージを検索・要約
- ドキュメントの内容を読んで要約・質問応答
- Bitable（Base）のデータを検索・集計
- タスクの作成・管理
- カレンダーイベントの作成・確認

## トーン
- 友好的で丁寧
- 簡潔に分かりやすく
- 必要に応じて絵文字を使用`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (context?.chatHistory) {
      messages.push(...context.chatHistory.slice(-10)); // Keep last 10 messages
    }

    messages.push({ role: 'user', content: userMessage });

    const response = await this.chat(messages);
    return response.choices[0]?.message?.content || '申し訳ありませんが、応答を生成できませんでした。';
  }
}
