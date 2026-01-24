import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dotenv to prevent loading .env file
vi.mock('dotenv', () => ({
  default: {
    config: vi.fn(),
  },
}));

describe('Config Module', () => {
  beforeEach(() => {
    vi.resetModules();
    // Clear all environment variables before each test
    delete process.env.LARK_APP_ID;
    delete process.env.LARK_APP_SECRET;
    delete process.env.GLM_API_KEY;
    delete process.env.PORT;
    delete process.env.WEBHOOK_PATH;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should load config with all required environment variables', async () => {
    vi.stubEnv('LARK_APP_ID', 'test-app-id');
    vi.stubEnv('LARK_APP_SECRET', 'test-secret');
    vi.stubEnv('GLM_API_KEY', 'test-key');

    const { config } = await import('../src/config.js');

    expect(config.larkAppId).toBe('test-app-id');
    expect(config.larkAppSecret).toBe('test-secret');
    expect(config.glmApiKey).toBe('test-key');
  });

  it('should use default port 3000', async () => {
    vi.stubEnv('LARK_APP_ID', 'test-app-id');
    vi.stubEnv('LARK_APP_SECRET', 'test-secret');
    vi.stubEnv('GLM_API_KEY', 'test-key');

    const { config } = await import('../src/config.js');

    expect(config.port).toBe(3000);
  });

  it('should use custom port from environment', async () => {
    vi.stubEnv('LARK_APP_ID', 'test-app-id');
    vi.stubEnv('LARK_APP_SECRET', 'test-secret');
    vi.stubEnv('GLM_API_KEY', 'test-key');
    vi.stubEnv('PORT', '8080');

    const { config } = await import('../src/config.js');

    expect(config.port).toBe(8080);
  });

  it('should use default webhook path', async () => {
    vi.stubEnv('LARK_APP_ID', 'test-app-id');
    vi.stubEnv('LARK_APP_SECRET', 'test-secret');
    vi.stubEnv('GLM_API_KEY', 'test-key');

    const { config } = await import('../src/config.js');

    expect(config.webhookPath).toBe('/webhook/event');
  });

  it('should have correct Lark domain', async () => {
    vi.stubEnv('LARK_APP_ID', 'test-app-id');
    vi.stubEnv('LARK_APP_SECRET', 'test-secret');
    vi.stubEnv('GLM_API_KEY', 'test-key');

    const { config, LARK_DOMAIN } = await import('../src/config.js');

    expect(config.larkDomain).toBe('https://open.feishu.cn');
    expect(LARK_DOMAIN).toBe('https://open.feishu.cn');
  });

  it('should have correct GLM API base URL', async () => {
    vi.stubEnv('LARK_APP_ID', 'test-app-id');
    vi.stubEnv('LARK_APP_SECRET', 'test-secret');
    vi.stubEnv('GLM_API_KEY', 'test-key');

    const { config, GLM_API_BASE_URL } = await import('../src/config.js');

    expect(config.glmApiBaseUrl).toBe('https://api.z.ai/api/paas/v4');
    expect(GLM_API_BASE_URL).toBe('https://api.z.ai/api/paas/v4');
  });

  it('should have correct GLM model', async () => {
    vi.stubEnv('LARK_APP_ID', 'test-app-id');
    vi.stubEnv('LARK_APP_SECRET', 'test-secret');
    vi.stubEnv('GLM_API_KEY', 'test-key');

    const { config, GLM_MODEL } = await import('../src/config.js');

    expect(config.glmModel).toBe('glm-4.7');
    expect(GLM_MODEL).toBe('glm-4.7');
  });

  it('should throw error for missing LARK_APP_ID', async () => {
    vi.stubEnv('LARK_APP_SECRET', 'test-secret');
    vi.stubEnv('GLM_API_KEY', 'test-key');

    await expect(import('../src/config.js')).rejects.toThrow('Missing required environment variable: LARK_APP_ID');
  });

  it('should throw error for missing LARK_APP_SECRET', async () => {
    vi.stubEnv('LARK_APP_ID', 'test-app-id');
    vi.stubEnv('GLM_API_KEY', 'test-key');

    await expect(import('../src/config.js')).rejects.toThrow('Missing required environment variable: LARK_APP_SECRET');
  });

  it('should throw error for missing GLM_API_KEY', async () => {
    vi.stubEnv('LARK_APP_ID', 'test-app-id');
    vi.stubEnv('LARK_APP_SECRET', 'test-secret');

    await expect(import('../src/config.js')).rejects.toThrow('Missing required environment variable: GLM_API_KEY');
  });
});
