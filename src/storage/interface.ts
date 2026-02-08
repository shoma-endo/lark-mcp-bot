import type { ConversationMessage } from '../types.js';

/**
 * Conversation storage interface
 * Supports both in-memory and persistent storage (Redis)
 */
export interface ConversationStorage {
  /**
   * Get conversation history for a chat
   */
  getHistory(chatId: string): Promise<ConversationMessage[]>;

  /**
   * Set conversation history for a chat
   */
  setHistory(chatId: string, messages: ConversationMessage[]): Promise<void>;

  /**
   * Delete conversation history for a chat
   */
  deleteHistory(chatId: string): Promise<void>;

  /**
   * Get all chat IDs with conversation history
   */
  getAllChatIds(): Promise<string[]>;

  /**
   * Get timestamp of last update for a chat
   */
  getTimestamp(chatId: string): Promise<number | null>;

  /**
   * Set timestamp for a chat
   */
  setTimestamp(chatId: string, timestamp: number): Promise<void>;

  /**
   * Cleanup expired conversations
   */
  cleanup(ttlMs: number): Promise<number>;
}
