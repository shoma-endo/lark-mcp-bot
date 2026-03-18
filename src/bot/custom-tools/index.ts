/**
 * Custom Tool Registry
 *
 * Provides an extensible framework for tools not available in lark-mcp.
 * To add a new tool:
 *   1. Create src/bot/custom-tools/your-tool.ts implementing CustomTool
 *   2. Import and register it in the registerAll() call below
 */

import { FunctionDefinition } from '../../types.js';

export interface CustomTool {
  /** Must be unique across MCP tools and custom tools */
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** When true, message-processor will look up and pass a user access token */
  requiresUAT?: boolean;
  execute(params: Record<string, unknown>, userAccessToken?: string): Promise<string>;
}

const registry = new Map<string, CustomTool>();

export function registerCustomTool(tool: CustomTool): void {
  registry.set(tool.name, tool);
}

export function getCustomTool(name: string): CustomTool | undefined {
  return registry.get(name);
}

export function getAllCustomTools(): CustomTool[] {
  return Array.from(registry.values());
}

export function toFunctionDefinition(tool: CustomTool): FunctionDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: tool.parameters.type,
        properties: tool.parameters.properties,
        required: tool.parameters.required ?? [],
      },
    },
  };
}

// ─── Register all custom tools here ───────────────────────────────────────────

import { calendarEventListTool } from './calendar-event-list.js';
import { taskListTool } from './task-list.js';

registerCustomTool(calendarEventListTool);
registerCustomTool(taskListTool);
