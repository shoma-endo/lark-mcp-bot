import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LarkMCPBot } from '../src/bot/index.js';

// Mock dependencies
vi.mock('@larksuiteoapi/node-sdk', () => {
    return {
        Client: vi.fn().mockImplementation(() => ({
            im: {
                message: {
                    reply: vi.fn().mockResolvedValue({ data: { message_id: 'reply123' } }),
                },
            },
        })),
        EventDispatcher: vi.fn().mockImplementation(() => ({
            register: vi.fn(),
        })),
        LoggerLevel: { info: 1 },
    };
});

vi.mock('../src/bot/message-processor.js', () => {
    return {
        MessageProcessor: vi.fn().mockImplementation(() => ({
            process: vi.fn().mockImplementation(async () => {
                // Simulate long processing (500ms)
                await new Promise(r => setTimeout(r, 500));
                return 'Bot response';
            }),
        })),
    };
});

describe('LarkMCPBot Duplicate Message Reproduction', () => {
    it('should not process the same message twice even if calls are concurrent', async () => {
        const bot = new LarkMCPBot();
        const messageEvent = {
            event_id: 'event-unique-123',
            message: {
                message_id: 'msg-unique-123',
                chat_id: 'chat-123',
                content: JSON.stringify({ text: 'Hello' }),
            },
            sender: { sender_type: 'user' },
        };

        // Simulate two concurrent requests with the same event_id
        const p1 = (bot as any).handleMessageReceive(messageEvent);
        const p2 = (bot as any).handleMessageReceive(messageEvent);

        // handleMessageReceive now returns almost immediately (after dedup check)
        await Promise.all([p1, p2]);

        // Deterministically wait for the async processing to finish
        await bot.waitForPendingProcessing();

        // MessageProcessor.process should only have been called ONCE
        const messageProcessor = bot.getMessageProcessor();
        expect(messageProcessor.process).toHaveBeenCalledTimes(1);
        
        // Lark reply should only have been called ONCE
        expect(bot.larkClient.im.message.reply).toHaveBeenCalledTimes(1);
        
        // Verify uuid was passed to Lark API
        expect(bot.larkClient.im.message.reply).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                uuid: 'event-unique-123'
            })
        }));
    });
});
