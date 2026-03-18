import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  // Lark Configuration
  larkAppId: string;
  larkAppSecret: string;
  larkDomain: string;
  larkOAuthRedirectUri: string;

  // GLM Configuration
  glmApiKey: string;
  glmApiBaseUrl: string;
  glmModel: string;
  glmMaxTokens: number;

  // Server Configuration
  port: number;
  webhookPath: string;

  // Logging Configuration
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enablePerformanceMetrics: boolean;

  // MCP Tool Filtering
  disabledTools: string[];
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || '';
}

// Constants (base URL and model can be overridden by env vars)
const LARK_DOMAIN = 'https://open.larksuite.com';
const GLM_API_BASE_URL = getEnvVar('GLM_API_BASE_URL', 'https://api.z.ai/api/coding/paas/v4');
const GLM_MODEL = getEnvVar('GLM_MODEL', 'glm-4.7');
const GLM_MAX_TOKENS = 4096;

export const config: Config = {
  larkAppId: getEnvVar('LARK_APP_ID'),
  larkAppSecret: getEnvVar('LARK_APP_SECRET'),
  larkDomain: LARK_DOMAIN,
  larkOAuthRedirectUri: getEnvVar('LARK_OAUTH_REDIRECT_URI', ''),

  glmApiKey: getEnvVar('GLM_API_KEY'),
  glmApiBaseUrl: GLM_API_BASE_URL,
  glmModel: GLM_MODEL,
  glmMaxTokens: GLM_MAX_TOKENS,

  port: parseInt(getEnvVar('PORT', '3000'), 10),
  webhookPath: getEnvVar('WEBHOOK_PATH', '/webhook/event'),

  // Logging settings
  logLevel: (getEnvVar('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error'),
  enablePerformanceMetrics: getEnvVar('ENABLE_PERFORMANCE_METRICS', 'true') === 'true',

  // MCP Tool Filtering (comma-separated)
  // Explicitly disabled tools only
  disabledTools: getEnvVar('DISABLED_TOOLS', '').split(',').filter(Boolean),
};

// Export constants for reference
export { LARK_DOMAIN, GLM_API_BASE_URL, GLM_MODEL };
