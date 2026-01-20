/**
 * Health check endpoint
 */

export default async function handler(req: any, res: any) {
  res.status(200).json({
    status: 'ok',
    bot: 'Lark MCP AI Agent Bot',
    timestamp: new Date().toISOString(),
  });
}
