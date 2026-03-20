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
import {
  getAllCustomTools,
  getCustomTool,
  toFunctionDefinition,
} from './custom-tools/index.js';

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
   * Convert MCP tools to GLM function calling format.
   *
   * Each MCP tool schema is `{ data: ZodObject, path: ZodObject, useUAT?: ZodBool }`.
   * We use Zod v4's built-in `toJSONSchema()` to convert both the `data` (body) and
   * `path` (URL path params) schemas into a flat JSON Schema the LLM can use.
   *
   * On execution, `normalizeToolParameters` restructures the flat params back into
   * the `{ path: {...}, data: {...} }` shape the Lark SDK expects.
   */
  convertMcpToolsToFunctions(): FunctionDefinition[] {
    const allMcpTools = this.mcpTool.getTools() as MCPTool[];
    const mcpTools = this.filterMcpTools(allMcpTools);

    const mcpDefs = mcpTools.map((tool: MCPTool): FunctionDefinition => {
      const rawSchema = tool.schema as unknown as Record<string, unknown>;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      // Extract data body fields (field_name, type, ui_type, etc.)
      const dataSchema = rawSchema['data'] as { toJSONSchema?: () => unknown } | undefined;
      if (typeof dataSchema?.toJSONSchema === 'function') {
        try {
          const js = dataSchema.toJSONSchema() as {
            properties?: Record<string, unknown>;
            required?: string[];
          };
          for (const [k, v] of Object.entries(js.properties ?? {})) {
            properties[k] = v;
          }
          for (const r of js.required ?? []) {
            if (!required.includes(r as string)) required.push(r as string);
          }
        } catch { /* ignore schema conversion errors */ }
      }

      // Extract path params (app_token, table_id, etc.) — always required, take precedence
      const pathSchema = rawSchema['path'] as { toJSONSchema?: () => unknown } | undefined;
      if (typeof pathSchema?.toJSONSchema === 'function') {
        try {
          const js = pathSchema.toJSONSchema() as {
            properties?: Record<string, unknown>;
            required?: string[];
          };
          for (const [k, v] of Object.entries(js.properties ?? {})) {
            properties[k] = v; // path params override same-named data params
          }
          for (const r of js.required ?? []) {
            if (!required.includes(r as string)) required.push(r as string);
          }
        } catch { /* ignore */ }
      } else {
        // Fallback: extract `:param` from URL template when toJSONSchema is unavailable
        const rawTool = tool as unknown as Record<string, unknown>;
        const urlTemplate = rawTool['path'] as string | undefined;
        for (const m of urlTemplate?.match(/:([^/]+)/g) ?? []) {
          const param = m.slice(1);
          if (!properties[param]) {
            properties[param] = { type: 'string', description: `Required path parameter: ${param}` };
          }
          if (!required.includes(param)) required.push(param);
        }
      }

      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: { type: 'object', properties, required },
        },
      };
    });

    // Append custom tools (not available in lark-mcp)
    const customDefs = getAllCustomTools()
      .filter((ct) => !config.disabledTools.includes(ct.name))
      .map(toFunctionDefinition);

    return [...mcpDefs, ...customDefs];
  }

  /**
   * Execute an MCP tool call.
   * @param userAccessToken When provided, the tool runs as that user (UAT mode).
   */
  async executeToolCall(
    toolName: string,
    parameters: Record<string, unknown>,
    userAccessToken?: string
  ): Promise<string> {
    const context: LogContext = { toolName };
    const metricId = `tool_${toolName}_${Date.now()}`;

    try {
      if (!toolName) {
        throw new ValidationError('Invalid tool name', 'toolName');
      }

      const { disabledTools } = config;
      if (disabledTools.includes(toolName)) {
        throw new ToolExecutionError(`Tool ${toolName} is disabled`, toolName);
      }

      // ── Custom tool path ──────────────────────────────────────────────────
      const customTool = getCustomTool(toolName);
      if (customTool) {
        logger.startMetric(metricId, `execute_tool_${toolName}`, { parameters });
        const content = await customTool.execute(parameters, userAccessToken);
        logger.endMetric(metricId, context, { resultLength: content.length });
        return content;
      }

      // ── MCP tool path ─────────────────────────────────────────────────────
      const normalizedParameters = this.normalizeToolParameters(toolName, parameters);
      logger.startMetric(metricId, `execute_tool_${toolName}`, { parameters: normalizedParameters });

      const mcpTools = this.mcpTool.getTools() as MCPTool[];
      const tool = mcpTools.find((t: MCPTool) => t.name === toolName);

      if (!tool) {
        throw new ToolExecutionError(`Tool ${toolName} not found`, toolName);
      }

      this.validateRequiredParameters(tool, normalizedParameters);

      const handlerParams = userAccessToken
        ? { ...normalizedParameters, useUAT: true }
        : normalizedParameters;
      const handlerOptions = { tool: tool as any, ...(userAccessToken ? { userAccessToken } : {}) };
      const result = await larkOapiHandler(this.larkClient, handlerParams, handlerOptions) as MCPToolResult;

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
    const path = parameters.path && typeof parameters.path === 'object' && !Array.isArray(parameters.path)
      ? (parameters.path as Record<string, unknown>)
      : undefined;

    const missing = required.filter((key) => {
      const value = parameters[key] ?? data?.[key] ?? path?.[key];
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
    if (toolName.startsWith('task.')) {
      return this.normalizeTaskParameters(linkNormalized);
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

  private normalizeTaskParameters(parameters: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = { ...parameters };
    const STRUCTURAL_KEYS = new Set(['data', 'params', 'path', 'useUAT']);

    // If LLM sent flat params (no data wrapper), wrap body params in data
    const existingData = normalized.data && typeof normalized.data === 'object' && !Array.isArray(normalized.data)
      ? { ...(normalized.data as Record<string, unknown>) }
      : null;

    let bodyData: Record<string, unknown>;
    if (existingData) {
      bodyData = existingData;
    } else {
      bodyData = {};
      for (const key of Object.keys(normalized)) {
        if (!STRUCTURAL_KEYS.has(key) && key !== 'user_id_type') {
          bodyData[key] = normalized[key];
          delete normalized[key];
        }
      }
    }

    // Move user_id_type to params (query param, not body)
    const userIdType = normalized.user_id_type ?? bodyData.user_id_type;
    if (userIdType) {
      const existingParams = normalized.params && typeof normalized.params === 'object'
        ? { ...(normalized.params as Record<string, unknown>) }
        : {};
      existingParams.user_id_type = userIdType;
      normalized.params = existingParams;
      delete normalized.user_id_type;
      delete bodyData.user_id_type;
    }

    // Coerce due.timestamp to milliseconds string
    const due = bodyData.due;
    if (due && typeof due === 'object' && !Array.isArray(due)) {
      const dueObj = { ...(due as Record<string, unknown>) };
      const ts = dueObj.timestamp;
      if (ts !== undefined && ts !== null) {
        dueObj.timestamp = this.coerceToMillisecondsString(ts);
      }
      bodyData.due = dueObj;
    }

    if (Object.keys(bodyData).length > 0) normalized.data = bodyData;
    return normalized;
  }

  /** Convert a timestamp value to a millisecond epoch string for Lark task API. */
  private coerceToMillisecondsString(value: unknown): string {
    if (typeof value === 'number') {
      return value < 10_000_000_000 ? String(value * 1000) : String(value);
    }
    if (typeof value === 'string') {
      if (/^\d{13,}$/.test(value)) return value; // already ms
      if (/^\d{10}$/.test(value)) return String(Number(value) * 1000); // seconds
      // date string like "2026-03-26" or "2026/3/26"
      const date = new Date(value.replace(/\//g, '-'));
      if (!isNaN(date.getTime())) return String(date.getTime());
    }
    return String(value);
  }

  private normalizeBitableParameters(parameters: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = { ...parameters };
    const existingData = normalized.data && typeof normalized.data === 'object' && !Array.isArray(normalized.data)
      ? { ...(normalized.data as Record<string, unknown>) }
      : {};

    // --- Step 1: Extract app_token from URL if missing ---
    const hasAppToken = (typeof normalized.app_token === 'string' && normalized.app_token.trim()) ||
      (typeof existingData.app_token === 'string' && (existingData.app_token as string).trim());

    if (!hasAppToken) {
      const candidateSources: string[] = [];
      const maybePush = (value: unknown): void => {
        if (typeof value === 'string' && value.trim()) candidateSources.push(value.trim());
      };
      maybePush(normalized.url);
      maybePush(normalized.base_url);
      maybePush(normalized.app_url);
      maybePush(normalized.text);
      maybePush(existingData.url);
      maybePush(existingData.base_url);
      maybePush(existingData.app_url);
      maybePush(existingData.text);

      for (const source of candidateSources) {
        const token = this.extractBitableAppToken(source);
        if (!token) continue;
        normalized.app_token = token;
        break;
      }
    }

    // --- Step 2: Move path parameters into path sub-object ---
    // The Lark SDK reads path params from params.path (used in fillApiPath).
    const existingPath = normalized.path && typeof normalized.path === 'object' && !Array.isArray(normalized.path)
      ? { ...(normalized.path as Record<string, unknown>) }
      : {};

    const BITABLE_PATH_PARAMS = ['app_token', 'table_id', 'record_id', 'field_id', 'view_id'];
    for (const key of BITABLE_PATH_PARAMS) {
      const val = normalized[key];
      if (typeof val === 'string' && val.trim()) {
        existingPath[key] = val.trim();
        delete normalized[key];
      }
    }
    if (Object.keys(existingPath).length > 0) normalized.path = existingPath;

    // --- Step 3: Parse JSON strings for body parameters and move to data ---
    for (const key of ['table', 'record', 'records']) {
      const val = normalized[key];
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          existingData[key] = parsed;
        } catch {
          existingData[key] = val;
        }
        delete normalized[key];
      } else if (val !== undefined && val !== null) {
        existingData[key] = val;
        delete normalized[key];
      }
    }

    // Parse fields (JSON string array) and merge into data.table if present
    if (normalized.fields !== undefined) {
      let parsedFields: unknown = normalized.fields;
      if (typeof parsedFields === 'string') {
        try { parsedFields = JSON.parse(parsedFields); } catch { /* keep */ }
      }
      if (Array.isArray(parsedFields)) {
        const tableInData = existingData.table;
        if (tableInData && typeof tableInData === 'object' && !Array.isArray(tableInData)) {
          (existingData.table as Record<string, unknown>).fields = parsedFields;
        } else {
          existingData.fields = parsedFields;
        }
      }
      delete normalized.fields;
    }

    // Merge default_view_name into data.table if present
    if (typeof normalized.default_view_name === 'string') {
      const tableInData = existingData.table;
      if (tableInData && typeof tableInData === 'object' && !Array.isArray(tableInData)) {
        (existingData.table as Record<string, unknown>).default_view_name = normalized.default_view_name;
      } else {
        existingData.default_view_name = normalized.default_view_name;
      }
      delete normalized.default_view_name;
    }

    // --- Step 4: Move remaining top-level body params into data ---
    // After Steps 2 & 3, any remaining top-level keys that aren't structural/path params
    // are body fields the LLM passed flat (e.g. field_name, type, ui_type, name, property).
    const BITABLE_STRUCTURAL_KEYS = new Set([
      'path', 'data', 'params', 'useUAT',
      'url', 'base_url', 'app_url', 'text', 'content', 'link',
      'doc_url', 'document_url', 'sheet_url', 'wiki_url',
    ]);
    for (const key of Object.keys(normalized)) {
      if (!BITABLE_STRUCTURAL_KEYS.has(key)) {
        existingData[key] = normalized[key];
        delete normalized[key];
      }
    }

    // --- Step 5: Coerce field `type` to number if LLM sent it as a string ---
    // Bitable field type is always a number (1=Text, 3=SingleSelect, etc.).
    // Some LLMs send it as "3" (string) which the API rejects.
    if (typeof existingData.type === 'string') {
      const n = Number(existingData.type);
      if (!isNaN(n)) existingData.type = n;
    }

    // --- Step 6: Normalize table.fields entries ---
    // LLMs often send {"name": "...", "type": 1} but Lark API requires {"field_name": "...", "type": 1}.
    // Also coerce type to number within each field entry.
    const tableData = existingData.table;
    if (tableData && typeof tableData === 'object' && !Array.isArray(tableData)) {
      const tbl = tableData as Record<string, unknown>;
      if (Array.isArray(tbl.fields)) {
        tbl.fields = tbl.fields.map((field: unknown) => {
          if (!field || typeof field !== 'object' || Array.isArray(field)) return field;
          const f = { ...(field as Record<string, unknown>) };
          if (f.name !== undefined && f.field_name === undefined) {
            f.field_name = f.name;
            delete f.name;
          }
          if (typeof f.type === 'string') {
            const n = Number(f.type);
            if (!isNaN(n)) f.type = n;
          }
          return f;
        });
        existingData.table = tbl;
      }
    }

    if (Object.keys(existingData).length > 0) normalized.data = existingData;

    return normalized;
  }

  private extractBitableAppToken(text: string): string | null {
    const basePathMatch = text.match(/\/base\/([a-zA-Z0-9]+)/);
    if (basePathMatch?.[1] && /^(basc|TS)[a-zA-Z0-9]{8,}$/.test(basePathMatch[1])) return basePathMatch[1];

    const genericMatch = text.match(/\b((?:basc|TS)[a-zA-Z0-9]{8,})\b/);
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
