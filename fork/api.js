/* Worker の `/api/*` を叩く薄い層。
 *
 * 元アプリは JSON をほとんど返さないので、Worker が HTML を JSON に変換している。
 * ここはその口を呼ぶだけ。デモモードのときは `demo.js` が同じ形を返す。
 */

export class Unauthenticated extends Error {}

async function request(path, init = {}) {
  const res = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...(init.headers || {}) }
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    // JSON でない応答（静的配信で /api が無い等）はステータスだけで判断する
  }

  if (res.status === 401) throw new Unauthenticated(body?.error || 'ログインしてください');
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

export const api = {
  me: () => request('/api/me'),
  login: (email, password) => request('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  }),
  logout: () => request('/api/session', { method: 'DELETE' }),

  dashboard: () => request('/api/dashboard'),
  reports: () => request('/api/reports'),
  orders: () => request('/api/orders'),
  equipments: () => request('/api/equipments'),
  loans: () => request('/api/loans'),
  notifications: () => request('/api/notifications'),
  unreadCount: () => request('/api/notifications/unread_count'),

  /** Discord Incoming Webhook へ Worker 経由で送る。URL は Worker に残さない。 */
  notifyDiscord: (webhookUrl, payload) => request('/api/notify/discord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhookUrl, payload })
  })
};
