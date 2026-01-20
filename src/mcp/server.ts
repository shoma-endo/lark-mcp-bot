/**
 * MCP Server for Lark Integration
 * Exposes Lark API capabilities as MCP tools
 */

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface MCPToolResult {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
}

/**
 * Lark MCP Server
 * Provides tools for interacting with Lark OpenAPI
 */
export class LarkMCPServer {
  private tools: Map<string, MCPTool>;
  private larkClient: any;

  constructor(larkClient: any) {
    this.larkClient = larkClient;
    this.tools = new Map();
    this.registerTools();
  }

  /**
   * Register available MCP tools
   */
  private registerTools(): void {
    // Message tools
    this.addTool({
      name: 'lark_send_message',
      description: 'Send a text message to a Lark chat',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: {
            type: 'string',
            description: 'The chat ID to send the message to',
          },
          text: {
            type: 'string',
            description: 'The message text to send',
          },
        },
        required: ['chat_id', 'text'],
      },
    });

    this.addTool({
      name: 'lark_list_messages',
      description: 'List messages in a Lark chat',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: {
            type: 'string',
            description: 'The chat ID to list messages from',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of messages to retrieve (default: 20)',
            default: 20,
          },
        },
        required: ['chat_id'],
      },
    });

    // Chat tools
    this.addTool({
      name: 'lark_get_chat',
      description: 'Get information about a Lark chat',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: {
            type: 'string',
            description: 'The chat ID to get information for',
          },
        },
        required: ['chat_id'],
      },
    });

    this.addTool({
      name: 'lark_create_chat',
      description: 'Create a new Lark group chat',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the chat',
          },
          user_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of user IDs to add to the chat',
          },
        },
        required: ['name', 'user_ids'],
      },
    });

    // User tools
    this.addTool({
      name: 'lark_get_user',
      description: 'Get information about a Lark user',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: {
            type: 'string',
            description: 'The user ID to get information for',
          },
        },
        required: ['user_id'],
      },
    });

    // Document tools
    this.addTool({
      name: 'lark_get_document',
      description: 'Get the content of a Lark document',
      inputSchema: {
        type: 'object',
        properties: {
          document_id: {
            type: 'string',
            description: 'The document ID to get content for',
          },
        },
        required: ['document_id'],
      },
    });

    // Bitable tools
    this.addTool({
      name: 'lark_search_bitable',
      description: 'Search records in a Lark Bitable table',
      inputSchema: {
        type: 'object',
        properties: {
          app_id: {
            type: 'string',
            description: 'The Bitable app ID',
          },
          table_id: {
            type: 'string',
            description: 'The table ID to search in',
          },
          filter: {
            type: 'object',
            description: 'Filter conditions for the search',
          },
        },
        required: ['app_id', 'table_id'],
      },
    });

    this.addTool({
      name: 'lark_create_bitable_record',
      description: 'Create a new record in a Lark Bitable table',
      inputSchema: {
        type: 'object',
        properties: {
          app_id: {
            type: 'string',
            description: 'The Bitable app ID',
          },
          table_id: {
            type: 'string',
            description: 'The table ID to create the record in',
          },
          record: {
            type: 'object',
            description: 'The record data to create',
          },
        },
        required: ['app_id', 'table_id', 'record'],
      },
    });

    this.addTool({
      name: 'lark_update_bitable_record',
      description: 'Update a record in a Lark Bitable table',
      inputSchema: {
        type: 'object',
        properties: {
          app_id: {
            type: 'string',
            description: 'The Bitable app ID',
          },
          table_id: {
            type: 'string',
            description: 'The table ID containing the record',
          },
          record_id: {
            type: 'string',
            description: 'The record ID to update',
          },
          record: {
            type: 'object',
            description: 'The record data to update',
          },
        },
        required: ['app_id', 'table_id', 'record_id', 'record'],
      },
    });
  }

  /**
   * Add a tool to the server
   */
  private addTool(tool: MCPTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get all available tools
   */
  getTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool call
   */
  async executeTool(name: string, args: any): Promise<MCPToolResult> {
    try {
      switch (name) {
        case 'lark_send_message':
          await this.larkClient.sendTextMessage(args.chat_id, args.text);
          return {
            content: [{ type: 'text', text: 'Message sent successfully' }],
          };

        case 'lark_list_messages':
          const messages = await this.larkClient.listMessages(args.chat_id, args.limit);
          return {
            content: [{ type: 'text', text: JSON.stringify(messages, null, 2) }],
          };

        case 'lark_get_chat':
          const chat = await this.larkClient.getChat(args.chat_id);
          return {
            content: [{ type: 'text', text: JSON.stringify(chat, null, 2) }],
          };

        case 'lark_create_chat':
          const newChatId = await this.larkClient.createChat(args.name, args.user_ids);
          return {
            content: [
              { type: 'text', text: `Chat created successfully: ${newChatId}` },
            ],
          };

        case 'lark_get_user':
          const user = await this.larkClient.getUser(args.user_id);
          return {
            content: [{ type: 'text', text: JSON.stringify(user, null, 2) }],
          };

        case 'lark_get_document':
          const doc = await this.larkClient.getDocumentContent(args.document_id);
          return {
            content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }],
          };

        case 'lark_search_bitable':
          const records = await this.larkClient.searchBitableRecords(
            args.app_id,
            args.table_id,
            args.filter
          );
          return {
            content: [{ type: 'text', text: JSON.stringify(records, null, 2) }],
          };

        case 'lark_create_bitable_record':
          const newRecord = await this.larkClient.createBitableRecord(
            args.app_id,
            args.table_id,
            args.record
          );
          return {
            content: [{ type: 'text', text: JSON.stringify(newRecord, null, 2) }],
          };

        case 'lark_update_bitable_record':
          const updated = await this.larkClient.updateBitableRecord(
            args.app_id,
            args.table_id,
            args.record_id,
            args.record
          );
          return {
            content: [
              { type: 'text', text: updated ? 'Record updated successfully' : 'Failed to update record' },
            ],
          };

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error executing tool: ${(error as Error).message}` },
        ],
        isError: true,
      };
    }
  }
}
