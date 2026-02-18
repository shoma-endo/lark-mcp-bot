import * as lark from '@larksuiteoapi/node-sdk';
import { LarkMcpTool } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/mcp-tool.js';
import { larkOapiHandler } from '@larksuiteoapi/lark-mcp/dist/mcp-tool/utils/index.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  MCPTool,
  MCPToolResult,
  LogContext,
  ValidationError,
  ToolExecutionError,
  FunctionDefinition,
} from '../types.js';

export class ToolExecutor {
  constructor(
    private larkClient: lark.Client,
    private mcpTool: LarkMcpTool
  ) {}

  /**
   * Filter MCP tools based on configuration
   */
  filterMcpTools(tools: MCPTool[]): MCPTool[] {
    const { disabledTools } = config;
    if (disabledTools.length === 0) return tools;

    const filtered = tools.filter((tool) => !disabledTools.includes(tool.name));

    logger.info(`MCP tools filtered`, undefined, {
      totalTools: tools.length,
      filteredTools: filtered.length,
      disabledTools: disabledTools,
    });

    return filtered;
  }

  /**
   * Convert MCP tools to GLM function calling format
   */
  convertMcpToolsToFunctions(): FunctionDefinition[] {
    const allMcpTools = this.mcpTool.getTools() as MCPTool[];
    const mcpTools = this.filterMcpTools(allMcpTools);

    return mcpTools.map((tool: MCPTool): FunctionDefinition => {
      const { schema } = tool;
      const cleanSchema = {
        type: (schema.type as string) || 'object',
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
   * Execute an MCP tool call
   */
  async executeToolCall(toolName: string, parameters: Record<string, unknown>): Promise<string> {
    const context: LogContext = { toolName };
    const metricId = `tool_${toolName}_${Date.now()}`;

    try {
      const normalizedParameters = this.normalizeToolParameters(toolName, parameters);
      logger.startMetric(metricId, `execute_tool_${toolName}`, { parameters: normalizedParameters });
      
      if (!toolName) {
        throw new ValidationError('Invalid tool name', 'toolName');
      }

      const { disabledTools } = config;
      if (disabledTools.includes(toolName)) {
        throw new ToolExecutionError(`Tool ${toolName} is disabled`, toolName);
      }

      const mcpTools = this.mcpTool.getTools() as MCPTool[];
      const tool = mcpTools.find((t: MCPTool) => t.name === toolName);

      if (!tool) {
        throw new ToolExecutionError(`Tool ${toolName} not found`, toolName);
      }

      this.validateRequiredParameters(tool, normalizedParameters);

      const result = await larkOapiHandler(this.larkClient, normalizedParameters, { tool: tool as any }) as MCPToolResult;

      if (result.isError) {
        const errorContent = this.formatToolError(result.content?.[0]?.text || JSON.stringify(result.content));
        throw new ToolExecutionError(`Tool execution failed: ${errorContent}`, toolName);
      }

      const content = result.content?.[0]?.text || JSON.stringify(result.content);
      
      logger.endMetric(metricId, context, { resultLength: content.length });
      return content;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.endMetric(metricId, context, { success: false, error: err.message });

      if (error instanceof ToolExecutionError || error instanceof ValidationError) {
        logger.warn(`Tool execution issue: ${err.message}`, context);
        return `Error: ${err.message}`;
      }

      logger.error(`Unexpected error during tool execution`, context, err);
      return `Error executing tool: ${err.message}`;
    }
  }

  /**
   * Detect create/update style tool names.
   */
  isMutationTool(toolName: string): boolean {
    return /(\.create$|\.patch$|\.update$|\.batchCreate$|\.batchUpdate$)/.test(toolName);
  }

  /**
   * Extract URLs from tool result text.
   */
  extractUrls(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s"'`<>]+/g) || [];
    return [...new Set(matches)];
  }

  /**
   * Build verification URLs for mutation tools.
   */
  buildMutationResultLinks(toolName: string, resultText: string): string[] {
    if (!this.isMutationTool(toolName)) return [];
    return this.extractUrls(resultText);
  }

  private validateRequiredParameters(tool: MCPTool, parameters: Record<string, unknown>): void {
    const required = (tool.schema?.required || []).filter((key): key is string => typeof key === 'string');
    if (required.length === 0) return;
    const data = parameters.data && typeof parameters.data === 'object' && !Array.isArray(parameters.data)
      ? (parameters.data as Record<string, unknown>)
      : undefined;

    const missing = required.filter((key) => {
      const value = parameters[key] ?? data?.[key];
      if (value === undefined || value === null) return true;
      if (typeof value === 'string' && value.trim() === '') return true;
      if (Array.isArray(value) && value.length === 0) return true;
      return false;
    });

    if (missing.length > 0) {
      throw new ValidationError(`Missing required parameters: ${missing.join(', ')}`, missing.join(', '));
    }
  }

  private normalizeToolParameters(toolName: string, parameters: Record<string, unknown>): Record<string, unknown> {
    const linkNormalized = this.normalizeLinkTokens(toolName, parameters);

    if (toolName.startsWith('bitable.')) {
      return this.normalizeBitableParameters(linkNormalized);
    }
    if (toolName !== 'calendar.v4.freebusy.list') return linkNormalized;

    const maybeData = linkNormalized.data;
    if (maybeData && typeof maybeData === 'object' && !Array.isArray(maybeData)) {
      return linkNormalized;
    }

    const flat = { ...linkNormalized };
    const data: Record<string, unknown> = {};
    const params: Record<string, unknown> = {};

    const getString = (key: string): string | undefined => {
      const value = flat[key];
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim();
      return trimmed || undefined;
    };

    const timeMin = getString('time_min');
    const timeMax = getString('time_max');
    if (timeMin) data.time_min = timeMin;
    if (timeMax) data.time_max = timeMax;

    const userId = getString('user_id');
    const roomId = getString('room_id');
    const userIds = Array.isArray(flat.user_ids) ? flat.user_ids.map(v => String(v)).filter(Boolean) : [];
    if (userId) data.user_id = userId;
    else if (!roomId && userIds.length > 0) data.user_id = userIds[0];
    if (roomId) data.room_id = roomId;

    if (typeof flat.include_external_calendar === 'boolean') {
      data.include_external_calendar = flat.include_external_calendar;
    }
    if (typeof flat.only_busy === 'boolean') {
      data.only_busy = flat.only_busy;
    }

    const userIdType = getString('user_id_type');
    if (userIdType) params.user_id_type = userIdType;

    const normalized: Record<string, unknown> = { ...linkNormalized };
    delete normalized.time_min;
    delete normalized.time_max;
    delete normalized.user_id;
    delete normalized.user_ids;
    delete normalized.room_id;
    delete normalized.include_external_calendar;
    delete normalized.only_busy;
    delete normalized.user_id_type;

    normalized.data = data;
    if (Object.keys(params).length > 0) normalized.params = params;
    return normalized;
  }

  private normalizeLinkTokens(toolName: string, parameters: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = { ...parameters };
    const data = normalized.data && typeof normalized.data === 'object' && !Array.isArray(normalized.data)
      ? { ...(normalized.data as Record<string, unknown>) }
      : undefined;

    const sources: string[] = [];
    const add = (v: unknown): void => {
      if (typeof v === 'string' && v.trim()) sources.push(v.trim());
    };
    for (const key of ['url', 'doc_url', 'document_url', 'sheet_url', 'wiki_url', 'link', 'text', 'content']) {
      add(normalized[key]);
      add(data?.[key]);
    }

    if (sources.length === 0) return normalized;

    for (const source of sources) {
      const token = this.extractTokenFromUrl(toolName, source);
      if (!token) continue;
      const targetKeys = this.getTokenTargetKeys(toolName);
      const key = targetKeys.find(k => !normalized[k] && !(data && data[k]));
      if (key) {
        normalized[key] = token;
        if (data) data[key] = token;
      }
      break;
    }

    if (data) normalized.data = data;
    return normalized;
  }

  private getTokenTargetKeys(toolName: string): string[] {
    if (toolName.startsWith('docx.')) {
      return ['document_id', 'document_token', 'obj_token', 'token'];
    }
    if (toolName.startsWith('sheets.')) {
      return ['spreadsheet_token', 'sheet_token', 'obj_token', 'token'];
    }
    if (toolName.startsWith('wiki.')) {
      return ['node_token', 'wiki_token', 'node_id', 'obj_token', 'token'];
    }
    if (toolName.startsWith('drive.')) {
      return ['file_token', 'token', 'obj_token'];
    }
    if (toolName.startsWith('bitable.')) {
      return ['app_token'];
    }
    return ['token', 'obj_token'];
  }

  private extractTokenFromUrl(toolName: string, text: string): string | null {
    if (toolName.startsWith('bitable.')) return this.extractBitableAppToken(text);

    const patterns: RegExp[] = [];
    if (toolName.startsWith('docx.')) patterns.push(/\/docx\/([a-zA-Z0-9]+)/, /\/docs\/([a-zA-Z0-9]+)/);
    if (toolName.startsWith('sheets.')) patterns.push(/\/sheets\/([a-zA-Z0-9]+)/);
    if (toolName.startsWith('wiki.')) patterns.push(/\/wiki\/([a-zA-Z0-9]+)/);
    if (toolName.startsWith('drive.')) patterns.push(/\/file\/([a-zA-Z0-9]+)/, /\/drive\/[a-z]+\/([a-zA-Z0-9]+)/);

    for (const pattern of patterns) {
      const matched = text.match(pattern);
      if (matched?.[1]) return matched[1];
    }

    const generic = text.match(/\/(docx|docs|sheets|wiki)\/([a-zA-Z0-9]+)/);
    if (generic?.[2]) return generic[2];
    return null;
  }

  private normalizeBitableParameters(parameters: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = { ...parameters };
    const data = normalized.data && typeof normalized.data === 'object' && !Array.isArray(normalized.data)
      ? { ...(normalized.data as Record<string, unknown>) }
      : undefined;

    const existingAppToken = typeof normalized.app_token === 'string'
      ? normalized.app_token.trim()
      : (typeof data?.app_token === 'string' ? String(data.app_token).trim() : '');
    if (existingAppToken) return normalized;

    const candidateSources: string[] = [];
    const maybePush = (value: unknown): void => {
      if (typeof value === 'string' && value.trim()) candidateSources.push(value.trim());
    };
    maybePush(normalized.url);
    maybePush(normalized.base_url);
    maybePush(normalized.app_url);
    maybePush(normalized.text);
    maybePush(data?.url);
    maybePush(data?.base_url);
    maybePush(data?.app_url);
    maybePush(data?.text);

    for (const source of candidateSources) {
      const token = this.extractBitableAppToken(source);
      if (!token) continue;
      normalized.app_token = token;
      if (data) {
        data.app_token = token;
        normalized.data = data;
      }
      break;
    }

    return normalized;
  }

  private extractBitableAppToken(text: string): string | null {
    const basePathMatch = text.match(/\/base\/([a-zA-Z0-9]+)/);
    if (basePathMatch?.[1]?.startsWith('basc')) return basePathMatch[1];

    const genericMatch = text.match(/\b(basc[a-zA-Z0-9]{8,})\b/);
    if (genericMatch?.[1]) return genericMatch[1];

    return null;
  }

  private formatToolError(rawText: string): string {
    if (!rawText) return 'Unknown tool error';

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return rawText;
    }

    const message = String(parsed?.msg || parsed?.message || rawText);
    const code = parsed?.code;
    const scopeMatch = message.match(/required:\s*\[([^\]]+)\]/i);
    if (scopeMatch) {
      const scopes = scopeMatch[1].split(',').map((s: string) => s.trim()).filter(Boolean);
      if (scopes.length > 0) {
        return `Missing required scope(s): ${scopes.join(', ')}. Ask a Lark admin to grant these scopes and re-authorize the app.`;
      }
    }

    if (/app[_\s-]?token/i.test(message) && /(invalid|illegal|format|not found|not exist)/i.test(message)) {
      return 'Invalid Bitable app_token. Provide a Base URL containing /base/{app_token} (starts with "basc"), or pass app_token directly.';
    }

    if (/(access denied|forbidden|no permission|insufficient permission|not shared)/i.test(message) &&
      /(bitable|base|table|record|app_token)/i.test(message)) {
      return 'Cannot access this Bitable Base. Share the Base with the bot app and ensure Bitable read scopes are granted.';
    }

    if (code !== undefined) {
      return `[code: ${code}] ${message}`;
    }
    return message;
  }
}
