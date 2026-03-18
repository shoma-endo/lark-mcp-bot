import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getUATStore, UATRecord } from '../src/storage/uat-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const { code, state } = req.query as Record<string, string | undefined>;

  if (!code || !state) {
    res.status(400).send('Missing code or state parameter');
    return;
  }

  const store = getUATStore();
  const openId = await store.getAndDeleteOAuthState(state);
  if (!openId) {
    res.status(400).send('Invalid or expired OAuth state. Please try again from the chat.');
    return;
  }

  const appId = process.env.LARK_APP_ID!;
  const appSecret = process.env.LARK_APP_SECRET!;
  const redirectUri = process.env.LARK_OAUTH_REDIRECT_URI!;

  try {
    const tokenRes = await fetch('https://open.larksuite.com/open-apis/authen/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: appId,
        client_secret: appSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      res.status(500).send(`Token exchange failed: ${errText}`);
      return;
    }

    const data = await tokenRes.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!data.access_token || !data.refresh_token) {
      res.status(500).send('Token exchange returned incomplete data');
      return;
    }

    const record: UATRecord = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in ?? 7200),
    };
    await store.setUAT(openId, record);

    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(`
      <!DOCTYPE html>
      <html><head><title>認証完了</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>認証が完了しました</h2>
        <p>Larkのチャットに戻って、もう一度お試しください。</p>
        <script>setTimeout(() => window.close(), 3000)</script>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`Server error: ${(err as Error).message}`);
  }
}
