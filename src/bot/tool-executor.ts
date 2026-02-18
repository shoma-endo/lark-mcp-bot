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
        const errorContent = result.content?.[0]?.text || JSON.stringify(result.content);
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
    if (toolName !== 'calendar.v4.freebusy.list') return parameters;

    const maybeData = parameters.data;
    if (maybeData && typeof maybeData === 'object' && !Array.isArray(maybeData)) {
      return parameters;
    }

    const flat = { ...parameters };
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

    const normalized: Record<string, unknown> = { ...parameters };
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
}
