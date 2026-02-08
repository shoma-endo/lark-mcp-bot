import type { ConversationMessage } from '../types.js';
import type { ConversationStorage } from './interface.js';

/**
 * In-memory conversation storage
 * Used for local development and testing
 */
export class MemoryStorage implements ConversationStorage {
  private conversations: Map<string, ConversationMessage[]> = new Map();
  private timestamps: Map<string, number> = new Map();

  async getHistory(chatId: string): Promise<ConversationMessage[]> {
    return this.conversations.get(chatId) || [];
  }

  async setHistory(chatId: string, messages: ConversationMessage[]): Promise<void> {
    this.conversations.set(chatId, messages);
    this.timestamps.set(chatId, Date.now());
  }

  async deleteHistory(chatId: string): Promise<void> {
    this.conversations.delete(chatId);
    this.timestamps.delete(chatId);
  }

  async getAllChatIds(): Promise<string[]> {
    return Array.from(this.conversations.keys());
  }

  async getTimestamp(chatId: string): Promise<number | null> {
    return this.timestamps.get(chatId) || null;
  }

  async setTimestamp(chatId: string, timestamp: number): Promise<void> {
    this.timestamps.set(chatId, timestamp);
  }

  async cleanup(ttlMs: number): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [chatId, timestamp] of this.timestamps.entries()) {
      if (now - timestamp > ttlMs) {
        this.conversations.delete(chatId);
        this.timestamps.delete(chatId);
        cleaned++;
      }
    }

    return cleaned;
  }
}
