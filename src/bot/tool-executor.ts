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
      logger.startMetric(metricId, `execute_tool_${toolName}`, { parameters });
      
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

      this.validateRequiredParameters(tool, parameters);

      const result = await larkOapiHandler(this.larkClient, parameters, { tool: tool as any }) as MCPToolResult;

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

    const missing = required.filter((key) => {
      const value = parameters[key];
      if (value === undefined || value === null) return true;
      if (typeof value === 'string' && value.trim() === '') return true;
      if (Array.isArray(value) && value.length === 0) return true;
      return false;
    });

    if (missing.length > 0) {
      throw new ValidationError(`Missing required parameters: ${missing.join(', ')}`, missing.join(', '));
    }
  }
}
