import * as lark from '@larksuiteoapi/node-sdk';
import OpenAI from 'openai';
import { LarkMcpTool } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/mcp-tool.js';
import { larkOapiHandler } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/utils/index.js';
import { config } from '../config.js';

/**
 * Helper function to send text message via Lark API
 */
async function sendTextMessage(client: lark.Client, chatId: string, text: string): Promise<void> {
  await client.im.message.create({
    params: {
      receive_id_type: 'chat_id',
    },
    data: {
      receive_id: chatId,
      content: JSON.stringify({ text }),
      msg_type: 'text',
    },
  });
}

/**
 * Lark MCP AI Agent Bot
 * Main bot logic integrating Lark, MCP, and GLM-4.7
 */
export class LarkMCPBot {
  public larkClient: lark.Client;
  public openai: OpenAI;
  public mcpTool: LarkMcpTool;
  private eventDispatcher: lark.EventDispatcher;

  // Conversation history per chat
  private conversations: Map<string, any[]> = new Map();

  // MCP tools as GLM function definitions
  private functionDefinitions: any[] = [];

  constructor() {
    this.larkClient = new lark.Client({
      appId: config.larkAppId,
      appSecret: config.larkAppSecret,
      domain: config.larkDomain,
    });

    // Initialize OpenAI client with GLM-4.7
    this.openai = new OpenAI({
      apiKey: config.glmApiKey,
      baseURL: config.glmApiBaseUrl,
    });

    // Initialize Lark MCP Tool (no auth for app-level access)
    this.mcpTool = new LarkMcpTool({
      appId: config.larkAppId,
      appSecret: config.larkAppSecret,
      domain: config.larkDomain,
      toolsOptions: {
        language: 'en',
      },
    }, undefined);

    // Convert MCP tools to GLM function definitions
    this.functionDefinitions = this.convertMcpToolsToFunctions();

    this.eventDispatcher = this.createEventDispatcher();
  }

  /**
   * Convert MCP tools to GLM function calling format
   * Cleans up JSON Schema properties not needed by GLM-4.7
   */
  private convertMcpToolsToFunctions(): any[] {
    const mcpTools = this.mcpTool.getTools();

    return mcpTools.map((tool: any) => {
      // Clean up schema - remove MCP-specific properties
      const { schema } = tool;
      const cleanSchema = {
        type: schema.type || 'object',
        properties: schema.properties || {},
        required: schema.required || [],
      };

      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: cleanSchema,
        },
      };
    });
  }

  /**
   * Create event dispatcher for Lark events
   */
  private createEventDispatcher(): lark.EventDispatcher {
    const dispatcher = new lark.EventDispatcher({
      encryptKey: process.env.LARK_ENCRYPT_KEY,
      loggerLevel: lark.LoggerLevel.info,
    });

    // Register message received handler
    dispatcher.register({
      'im.message.receive_v1': this.handleMessageReceive.bind(this),
    });

    return dispatcher;
  }

  /**
   * Execute an MCP tool call
   */
  private async executeToolCall(toolName: string, parameters: any): Promise<string> {
    try {
      console.log(`[MCP] Executing tool: ${toolName}`, JSON.stringify(parameters).substring(0, 200));

      // Find the tool definition
      const mcpTools = this.mcpTool.getTools();
      const tool = mcpTools.find((t: any) => t.name === toolName);

      if (!tool) {
        return `Error: Tool ${toolName} not found`;
      }

      // Execute using the larkOapiHandler from MCP package
      const result = await larkOapiHandler(this.larkClient, parameters, { tool });

      if (result.isError) {
        return `Error: ${JSON.stringify(result.content)}`;
      }

      // Return the result content
      const content = result.content?.[0]?.text || JSON.stringify(result.content);
      return content;
    } catch (error: any) {
      console.error(`[MCP] Tool execution error:`, error);
      return `Error executing tool: ${error?.message || error}`;
    }
  }

  /**
   * Handle incoming message event with Function Calling
   */
  private async handleMessageReceive(data: any): Promise<void> {
    const { message, sender } = data;

    try {
      // Parse message content
      let messageText = '';
      if (message.content) {
        try {
          const content = JSON.parse(message.content);
          messageText = content.text || '';
        } catch {
          messageText = message.content || '';
        }
      }

      if (!messageText || messageText.trim() === '') {
        return;
      }

      console.log(`[${sender.sender_id.user_id}]: ${messageText}`);

      // Get or create conversation history
      const chatId = message.chat_id;
      if (!this.conversations.has(chatId)) {
        this.conversations.set(chatId, []);
      }
      const history = this.conversations.get(chatId)!;

      // Remove mention from message text
      const cleanText = messageText.replace(/@_user_\d+\s*/g, '');

      // Add user message to history
      history.push({ role: 'user', content: cleanText });

      // Build system prompt with tool descriptions
      const systemPrompt = `あなたはLarkのAIアシスタントボットです。
ユーザーのリクエストに応じてLark APIを通じて様々な操作を実行できます。

利用可能なツール:
${this.functionDefinitions.map(f => `- ${f.function.name}: ${f.function.description}`).join('\n')}

日本語で丁寧に答えてください。ツールを実行する必要がある場合は、適切なツールを選択してください。`;

      // Build messages for GLM
      const messages: any[] = [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...history.slice(-10), // Keep last 10 messages for context
      ];

      // Generate AI response using OpenAI SDK with Function Calling
      const completion = await this.openai.chat.completions.create({
        model: config.glmModel,
        messages,
        tools: this.functionDefinitions,
        temperature: 0.7,
        max_tokens: 2000,
      });

      const responseMessage = completion.choices[0].message;

      // Check if the model wants to call a function
      const toolCalls = responseMessage.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        // Execute tool calls
        const toolResults: any[] = [];

        for (const toolCall of toolCalls) {
          // Type assertion for function call
          const fnCall = toolCall as any;
          const functionName = fnCall.function?.name || fnCall.name;
          // GLM-4.7 returns arguments as object, not JSON string
          const functionArgs = fnCall.function?.arguments || {};

          // Execute the tool
          const result = await this.executeToolCall(functionName, functionArgs);
          toolResults.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: result,
          });

          // Add assistant message with tool call to history
          history.push({
            role: 'assistant',
            content: responseMessage.content || '',
            tool_calls: toolCalls,
          });

          // Add tool result to history
          history.push(toolResults[toolResults.length - 1]);
        }

        // Get final response after tool execution
        const followUpCompletion = await this.openai.chat.completions.create({
          model: config.glmModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            ...history.slice(-20),
          ],
          temperature: 0.7,
          max_tokens: 2000,
        });

        const finalResponse = followUpCompletion.choices[0].message.content || 'すみません、応答を生成できませんでした。';

        // Add final assistant response to history
        history.push({ role: 'assistant', content: finalResponse });

        // Keep only last 30 messages (since we add tool calls)
        if (history.length > 30) {
          history.splice(0, history.length - 30);
        }

        // Send response
        await sendTextMessage(this.larkClient, chatId, finalResponse);

        console.log(`[Bot]: ${finalResponse.substring(0, 100)}...`);
      } else {
        // No tool calls, just respond
        const responseText = responseMessage.content || 'すみません、応答を生成できませんでした。';

        // Add assistant response to history
        history.push({ role: 'assistant', content: responseText });

        // Keep only last 20 messages
        if (history.length > 20) {
          history.splice(0, history.length - 20);
        }

        // Send response
        await sendTextMessage(this.larkClient, chatId, responseText);

        console.log(`[Bot]: ${responseText.substring(0, 100)}...`);
      }
    } catch (error) {
      console.error('Error handling message:', error);

      // Send error message
      try {
        await sendTextMessage(
          this.larkClient,
          message.chat_id,
          '申し訳ありません。エラーが発生しました。もう一度お試しください。'
        );
      } catch {
        // Ignore send error
      }
    }
  }

  /**
   * Get the event dispatcher for use with web server
   */
  getEventDispatcher(): lark.EventDispatcher {
    return this.eventDispatcher;
  }
}
