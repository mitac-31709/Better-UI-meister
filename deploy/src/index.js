/* Meister Management System フォークの Worker。
 *
 * - `POST /api/session`    利用者の資格情報で元アプリにログインする
 * - `DELETE /api/session`  ログアウトする
 * - `GET  /api/me`         ログイン中の利用者
 * - `GET  /api/<page>`     元アプリの画面を JSON にして返す
 * - それ以外               `public/` の静的ファイル（フォークの UI）
 *
 * 資格情報は保存しない。元アプリのセッション Cookie を AES-GCM で暗号化して
 * 自ドメインの Cookie に入れるだけ（`src/session.js`）。
 * 取得結果もキャッシュしない。利用者ごとの内容なので、Worker に共有で
 * 置くと他人のデータが混ざる。
 */

import { ApiError, html, signIn, signOut, unreadCount } from './meister.js';
import { parseReportsPage } from './parse.js';
import {
  parseDashboard, parseEquipments, parseLoans, parseNotifications,
  parseOrders, parseUser
} from './parse-pages.js';
import {
  SESSION_MAX_AGE_MS, clearCookieHeader, currentSession, seal, setCookieHeader
} from './session.js';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    }
  });

/** セッションが無い・壊れている・期限切れ。壊れた Cookie を送り続けさせない。 */
const unauthorized = () =>
  json({ error: 'ログインしてください', code: 'unauthenticated' }, 401,
    { 'Set-Cookie': clearCookieHeader() });

/** 元アプリの 1 画面を取って JSON にする */
async function page(cookie, path, parse) {
  const body = await html(cookie, path);
  return {
    source: 'live',
    origin: `https://meister.tokyo-ct.org${path}`,
    fetchedAt: new Date().toISOString(),
    ...parse(body)
  };
}

async function handleSessionCreate(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON の本文が必要です' }, 400);
  }

  const email = String(body?.email ?? '').trim();
  const password = String(body?.password ?? '');
  const cookie = await signIn(email, password);

  // 表示名は元アプリのダッシュボードから読む。こちらで持たない。
  let user = { name: null, badge: null };
  try {
    user = parseUser(await html(cookie, '/dashboard')) || user;
  } catch {
    // 表示名が取れなくてもログインは成立させる
  }

  const token = await seal(
    { cookie, name: user.name, badge: user.badge, exp: Date.now() + SESSION_MAX_AGE_MS },
    env.SESSION_SECRET
  );
  return json({ user }, 200, { 'Set-Cookie': setCookieHeader(token) });
}

async function handleSessionDelete(request, env) {
  const session = await currentSession(request, env);
  // 元アプリ側を無効化できたかどうかを応答に載せる。ここが false のまま
  // 気づかないと、Cookie を持っている相手はログアウト後も使えてしまう。
  const result = session?.cookie ? await signOut(session.cookie) : { ok: true };
  return json({ ok: true, originSignedOut: result.ok, reason: result.reason ?? null },
    200, { 'Set-Cookie': clearCookieHeader() });
}

const PAGES = {
  '/api/dashboard': ['/dashboard', parseDashboard],
  '/api/reports': ['/reports', parseReportsPage],
  '/api/orders': ['/orders', parseOrders],
  '/api/equipments': ['/equipments', parseEquipments],
  '/api/loans': ['/loans', parseLoans],
  '/api/notifications': ['/notifications', parseNotifications]
};

async function handleApi(request, url, env) {
  const path = url.pathname;

  if (path === '/api/session') {
    if (request.method === 'POST') return handleSessionCreate(request, env);
    if (request.method === 'DELETE') return handleSessionDelete(request, env);
    return json({ error: 'POST か DELETE を使ってください' }, 405,
      { Allow: 'POST, DELETE' });
  }

  if (path === '/api/health') {
    return json({
      ok: true,
      origin: 'https://meister.tokyo-ct.org',
      sessionSecret: Boolean(env.SESSION_SECRET),
      auth: 'per-user'
    });
  }

  if (request.method !== 'GET') {
    return json({ error: 'GET のみ受け付けます' }, 405, { Allow: 'GET' });
  }

  const session = await currentSession(request, env);
  if (!session) return unauthorized();

  if (path === '/api/me') {
    return json({ user: { name: session.name ?? null, badge: session.badge ?? null } });
  }

  if (path === '/api/notifications/unread_count') {
    return json(await unreadCount(session.cookie));
  }

  const target = PAGES[path];
  if (!target) return json({ error: 'そのような口はありません' }, 404);
  return json(await page(session.cookie, target[0], target[1]));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      return await handleApi(request, url, env);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      const payload = { error: e.message || String(e) };
      if (status !== 401) return json(payload, status);

      payload.code = 'unauthenticated';
      // 失効したセッションはブラウザからも落とす。ただしログインの
      // 入力ミスでは落とさない（開いているセッションを壊さないため）。
      return e.clearSession
        ? json(payload, 401, { 'Set-Cookie': clearCookieHeader() })
        : json(payload, 401);
    }
  }
};
