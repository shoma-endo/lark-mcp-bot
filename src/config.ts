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
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

// Hardcoded constants
const LARK_DOMAIN = 'https://open.feishu.cn';
const GLM_API_BASE_URL = 'https://api.z.ai/api/paas/v4';
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
};

// Export constants for reference
export { LARK_DOMAIN, GLM_API_BASE_URL, GLM_MODEL };
