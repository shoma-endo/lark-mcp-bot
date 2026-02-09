import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  // Lark Configuration
  larkAppId: string;
  larkAppSecret: string;
  larkDomain: string;

  // GLM Configuration
  glmApiKey: string;
  glmApiBaseUrl: string;
  glmModel: string;

  // Server Configuration
  port: number;
  webhookPath: string;

  // Logging Configuration
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enablePerformanceMetrics: boolean;

  // MCP Tool Filtering
  enabledToolPrefixes: string[];
  disabledTools: string[];
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || '';
}

// Hardcoded constants
const LARK_DOMAIN = 'https://open.larksuite.com';
const GLM_API_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const GLM_MODEL = 'glm-4.7';

export const config: Config = {
  larkAppId: getEnvVar('LARK_APP_ID'),
  larkAppSecret: getEnvVar('LARK_APP_SECRET'),
  larkDomain: LARK_DOMAIN,

  glmApiKey: getEnvVar('GLM_API_KEY'),
  glmApiBaseUrl: GLM_API_BASE_URL,
  glmModel: GLM_MODEL,

  port: parseInt(getEnvVar('PORT', '3000'), 10),
  webhookPath: getEnvVar('WEBHOOK_PATH', '/webhook/event'),

  // Logging settings
  logLevel: (getEnvVar('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error'),
  enablePerformanceMetrics: getEnvVar('ENABLE_PERFORMANCE_METRICS', 'true') === 'true',

  // MCP Tool Filtering (comma-separated)
  // Only include tools starting with these prefixes (empty = all)
  enabledToolPrefixes: getEnvVar('ENABLED_TOOL_PREFIXES', 'im.,contact.,drive.,calendar.').split(',').filter(Boolean),
  // Explicitly disabled tools (comma-separated)
  disabledTools: getEnvVar('DISABLED_TOOLS', '').split(',').filter(Boolean),
};

// Export constants for reference
export { LARK_DOMAIN, GLM_API_BASE_URL, GLM_MODEL };
