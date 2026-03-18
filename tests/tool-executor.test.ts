import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolExecutor } from '../src/bot/tool-executor.js';
import { config } from '../src/config.js';
import * as larkUtils from '@larksuiteoapi/lark-mcp/dist/mcp-tool/utils/index.js';

// Mock dependencies
vi.mock('@larksuiteoapi/lark-mcp/dist/mcp-tool/utils/index.js', () => ({
  larkOapiHandler: vi.fn(),
}));

vi.mock('../src/config.js', () => ({
  config: {
    disabledTools: [],
  },
}));

describe('ToolExecutor', () => {
  let toolExecutor: ToolExecutor;
  let mockLarkClient: any;
  let mockMcpTool: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLarkClient = {};
    mockMcpTool = {
      getTools: vi.fn().mockReturnValue([
        {
          name: 'test_tool',
          description: 'A test tool',
          schema: { type: 'object', properties: { p: { type: 'string' } } }
        },
        {
          name: 'test.tool.create',
          description: 'A mutation tool',
          schema: { type: 'object', properties: {} }
        },
        {
          name: 'disabled_tool',
          description: 'A disabled tool',
          schema: { type: 'object', properties: {} }
        },
        {
          name: 'calendar.v4.freebusy.list',
          description: 'Freebusy lookup',
          schema: {
            type: 'object',
            properties: {
              time_min: { type: 'string' },
              time_max: { type: 'string' },
              user_ids: { type: 'array' },
            },
            required: ['time_min', 'time_max'],
          }
        },
        {
          name: 'bitable.v1.appTable.list',
          description: 'List bitable tables',
          schema: {
            type: 'object',
            properties: {
              app_token: { type: 'string' },
            },
            required: ['app_token'],
          }
        },
        {
          name: 'docx.v1.document.rawContent',
          description: 'Get document content',
          schema: {
            type: 'object',
            properties: {
              document_id: { type: 'string' },
            },
            required: ['document_id'],
          }
        }
      ]),
    };
    toolExecutor = new ToolExecutor(mockLarkClient, mockMcpTool);
  });

  it('should filter MCP tools based on config', () => {
    config.disabledTools = ['disabled_tool'];
    const tools = mockMcpTool.getTools();
    const filtered = toolExecutor.filterMcpTools(tools);
    expect(filtered.length).toBe(5);
    expect(filtered.find(t => t.name === 'disabled_tool')).toBeUndefined();
    config.disabledTools = []; // Reset
  });

  it('should convert MCP tools to functions', () => {
    config.disabledTools = [];
    const functions = toolExecutor.convertMcpToolsToFunctions();
    expect(functions.length).toBe(7); // 6 MCP tools + 1 custom tool (calendar.v4.calendarEvent.list)
    expect(functions[0].function.name).toBe('test_tool');
    expect(functions[0].function.parameters.type).toBe('object');
  });

  it('should execute tool call successfully', async () => {
    (larkUtils.larkOapiHandler as any).mockResolvedValueOnce({
      isError: false,
      content: [{ type: 'text', text: 'Success response' }]
    });

    const result = await toolExecutor.executeToolCall('test_tool', { p: 'val' });
    expect(result).toBe('Success response');
  });

  it('should handle tool not found', async () => {
    const result = await toolExecutor.executeToolCall('non_existent', {});
    expect(result).toContain('Error');
    expect(result).toContain('not found');
  });

  it('should handle disabled tool', async () => {
    config.disabledTools = ['disabled_tool'];
    const result = await toolExecutor.executeToolCall('disabled_tool', {});
    expect(result).toContain('Error');
    expect(result).toContain('is disabled');
    config.disabledTools = []; // Reset
  });

  it('should handle validation error (empty tool name)', async () => {
    const result = await toolExecutor.executeToolCall('', {});
    expect(result).toContain('Error');
    expect(result).toContain('Invalid tool name');
  });

  it('should validate required tool parameters before execution', async () => {
    const result = await toolExecutor.executeToolCall('calendar.v4.freebusy.list', {
      time_min: '2025-02-18T00:00:00+09:00',
    });
    expect(result).toContain('Error');
    expect(result).toContain('Missing required parameters');
    expect(larkUtils.larkOapiHandler).not.toHaveBeenCalled();
  });

  it('should normalize freebusy flat arguments to payload.data/params', async () => {
    (larkUtils.larkOapiHandler as any).mockResolvedValueOnce({
      isError: false,
      content: [{ type: 'text', text: 'ok' }]
    });

    await toolExecutor.executeToolCall('calendar.v4.freebusy.list', {
      time_min: '2025-02-19T00:00:00+08:00',
      time_max: '2025-02-26T00:00:00+08:00',
      user_ids: ['me'],
      user_id_type: 'open_id',
    });

    expect(larkUtils.larkOapiHandler).toHaveBeenCalledWith(
      mockLarkClient,
      expect.objectContaining({
        data: expect.objectContaining({
          time_min: '2025-02-19T00:00:00+08:00',
          time_max: '2025-02-26T00:00:00+08:00',
          user_id: 'me',
        }),
        params: expect.objectContaining({
          user_id_type: 'open_id',
        }),
      }),
      expect.anything()
    );
  });

  it('should handle tool execution failure from handler', async () => {
    (larkUtils.larkOapiHandler as any).mockResolvedValueOnce({
      isError: true,
      content: [{ type: 'text', text: 'Handler Error' }]
    });

    const result = await toolExecutor.executeToolCall('test_tool', {});
    expect(result).toContain('Error');
    expect(result).toContain('Handler Error');
  });

  it('should format missing-scope errors clearly', async () => {
    (larkUtils.larkOapiHandler as any).mockResolvedValueOnce({
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({
          code: 99991672,
          msg: 'Access denied. One of the following scopes is required: [contact:user.employee_id:readonly]',
        }),
      }],
    });

    const result = await toolExecutor.executeToolCall('test_tool', {});
    expect(result).toContain('Missing required scope(s)');
    expect(result).toContain('contact:user.employee_id:readonly');
  });

  it('should extract bitable app_token from base URL', async () => {
    (larkUtils.larkOapiHandler as any).mockResolvedValueOnce({
      isError: false,
      content: [{ type: 'text', text: 'ok' }]
    });

    await toolExecutor.executeToolCall('bitable.v1.appTable.list', {
      url: 'https://example.feishu.cn/base/bascnAbCdEf12345?table=tblxxx',
    });

    expect(larkUtils.larkOapiHandler).toHaveBeenCalledWith(
      mockLarkClient,
      expect.objectContaining({
        path: expect.objectContaining({ app_token: 'bascnAbCdEf12345' }),
      }),
      expect.anything()
    );
  });

  it('should extract TS-prefixed bitable app_token from base URL', async () => {
    (larkUtils.larkOapiHandler as any).mockResolvedValueOnce({
      isError: false,
      content: [{ type: 'text', text: 'ok' }]
    });

    await toolExecutor.executeToolCall('bitable.v1.appTable.list', {
      url: 'https://mjpt22tawf9f.jp.larksuite.com/base/TSfwb28NxaOUDfsLAEijfeqfpnd?table=tblqDQVrR570D79o',
    });

    expect(larkUtils.larkOapiHandler).toHaveBeenCalledWith(
      mockLarkClient,
      expect.objectContaining({
        path: expect.objectContaining({ app_token: 'TSfwb28NxaOUDfsLAEijfeqfpnd' }),
      }),
      expect.anything()
    );
  });

  it('should format bitable access errors with actionable guidance', async () => {
    (larkUtils.larkOapiHandler as any).mockResolvedValueOnce({
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({
          code: 403,
          msg: 'Access denied for bitable base',
        }),
      }],
    });

    const result = await toolExecutor.executeToolCall('bitable.v1.appTable.list', {
      app_token: 'bascnAbCdEf12345',
    });
    expect(result).toContain('Cannot access this Bitable Base');
    expect(result).toContain('Share the Base with the bot app');
  });

  it('should extract document token from doc URL', async () => {
    (larkUtils.larkOapiHandler as any).mockResolvedValueOnce({
      isError: false,
      content: [{ type: 'text', text: 'ok' }]
    });

    await toolExecutor.executeToolCall('docx.v1.document.rawContent', {
      url: 'https://example.feishu.cn/docx/doxcnAbCdEf12345',
    });

    expect(larkUtils.larkOapiHandler).toHaveBeenCalledWith(
      mockLarkClient,
      expect.objectContaining({
        document_id: 'doxcnAbCdEf12345',
      }),
      expect.anything()
    );
  });

  it('should detect mutation tools', () => {
    expect(toolExecutor.isMutationTool('test.tool.create')).toBe(true);
    expect(toolExecutor.isMutationTool('test.tool.update')).toBe(true);
    expect(toolExecutor.isMutationTool('test_tool')).toBe(false);
  });

  it('should extract URLs and build mutation links', () => {
    const text = 'Check here: https://example.com and https://test.org';
    const urls = toolExecutor.extractUrls(text);
    expect(urls).toHaveLength(2);
    expect(urls).toContain('https://example.com');

    const links = toolExecutor.buildMutationResultLinks('test.tool.create', text);
    expect(links).toHaveLength(2);

    const nonMutationLinks = toolExecutor.buildMutationResultLinks('test_tool', text);
    expect(nonMutationLinks).toHaveLength(0);
  });
});
