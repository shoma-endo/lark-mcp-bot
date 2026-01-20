import * as lark from '@larksuiteoapi/node-sdk';
import { config } from '../config.js';

/**
 * Lark API Client Wrapper
 * Encapsulates Lark OpenAPI client with authentication
 */
export class LarkClient {
  private client: lark.Client;

  constructor() {
    this.client = new lark.Client({
      appId: config.larkAppId,
      appSecret: config.larkAppSecret,
      domain: config.larkDomain,
      appType: lark.AppType.SelfBuild,
      loggerLevel: lark.LoggerLevel.info,
    });
  }

  /**
   * Get the underlying Lark client
   */
  getClient(): lark.Client {
    return this.client;
  }

  /**
   * Send a text message to a chat
   */
  async sendTextMessage(chatId: string, text: string): Promise<void> {
    await this.client.im.message.create({
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
   * Send a rich text (interactive) message to a chat
   */
  async sendRichMessage(chatId: string, content: object): Promise<void> {
    await this.client.im.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data: {
        receive_id: chatId,
        content: JSON.stringify(content),
        msg_type: 'interactive',
      },
    });
  }

  /**
   * Get chat information
   */
  async getChat(chatId: string): Promise<any | null> {
    try {
      const response = await this.client.im.chat.get({
        path: { chat_id: chatId },
      });
      return response;
    } catch (error) {
      console.error('Failed to get chat:', error);
      return null;
    }
  }

  /**
   * List messages in a chat
   */
  async listMessages(chatId: string, limit = 20): Promise<any[]> {
    const messages: any[] = [];
    try {
      const response = await this.client.im.message.list({
        params: {
          container_id_type: 'chat_id',
          container_id: chatId,
          page_size: limit,
        },
      });
      if (response.data?.items) {
        messages.push(...response.data.items);
      }
    } catch (error) {
      console.error('Failed to list messages:', error);
    }
    return messages;
  }

  /**
   * Get user information
   */
  async getUser(userId: string): Promise<any | null> {
    try {
      return await this.client.contact.user.get({
        path: { user_id: userId },
      });
    } catch (error) {
      console.error('Failed to get user:', error);
      return null;
    }
  }

  /**
   * Create a group chat
   */
  async createChat(name: string, userIds: string[]): Promise<string | null> {
    try {
      const response = await this.client.im.chat.create({
        data: {
          name,
        },
      });
      const chatId = response.data?.chat_id;
      // Add users to chat
      if (chatId && userIds.length > 0) {
        await this.client.im.chatMembers.create({
          path: { chat_id: chatId },
          params: { member_id_type: 'user_id' },
          data: {
            id_list: userIds,
          },
        });
      }
      return chatId || null;
    } catch (error) {
      console.error('Failed to create chat:', error);
      return null;
    }
  }

  /**
   * Get document content
   */
  async getDocumentContent(documentId: string): Promise<object | null> {
    try {
      const response = await this.client.docx.document.rawContent({
        path: { document_id: documentId },
      });
      return response.data || null;
    } catch (error) {
      console.error('Failed to get document content:', error);
      return null;
    }
  }

  /**
   * Search Bitable records
   */
  async searchBitableRecords(appToken: string, tableId: string, filter: object): Promise<any[]> {
    try {
      const response = await this.client.bitable.appTableRecord.search({
        path: {
          app_token: appToken,
          table_id: tableId,
        },
        data: filter,
      });
      return response.data?.items || [];
    } catch (error) {
      console.error('Failed to search bitable records:', error);
      return [];
    }
  }

  /**
   * Create Bitable record
   */
  async createBitableRecord(
    appToken: string,
    tableId: string,
    record: Record<string, any>
  ): Promise<object | null> {
    try {
      const response = await this.client.bitable.appTableRecord.create({
        path: {
          app_token: appToken,
          table_id: tableId,
        },
        data: {
          fields: record,
        },
      });
      return response.data?.record || null;
    } catch (error) {
      console.error('Failed to create bitable record:', error);
      return null;
    }
  }

  /**
   * Update Bitable record
   */
  async updateBitableRecord(
    appToken: string,
    tableId: string,
    recordId: string,
    record: Record<string, any>
  ): Promise<boolean> {
    try {
      await this.client.bitable.appTableRecord.update({
        path: {
          app_token: appToken,
          table_id: tableId,
          record_id: recordId,
        },
        data: {
          fields: record,
        },
      });
      return true;
    } catch (error) {
      console.error('Failed to update bitable record:', error);
      return false;
    }
  }
}
