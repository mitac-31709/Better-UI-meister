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

  /** Discord Incoming Webhook へ Worker 経由で送る。即時中継（URL は残さない）。 */
  notifyDiscord: (webhookUrl, payload) => request('/api/notify/discord', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhookUrl, payload })
  }),

  /** タブ閉鎖後も Discord へ送る購読を登録する（Webhook とセッションを KV に封印）。 */
  subscribeNotify: (webhookUrl, id = null) => request('/api/notify/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhookUrl, id })
  }),

  /** 開いている間に Rails Cookie を購読へ書き戻す。 */
  refreshNotifySubscription: (id) => request('/api/notify/subscribe', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  }),

  unsubscribeNotify: (id) => request('/api/notify/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  }),

  /** 元アプリへ新しい注文を作る。Worker が Devise セッションで中継する。 */
  createOrder: (fields) => request('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields)
  })
};
