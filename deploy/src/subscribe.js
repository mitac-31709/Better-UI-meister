/* Discord のバックグラウンド配信購読。
 *
 * タブを閉じても Cron が未読を見て Discord へ送るため、KV に次を置く。
 *   - 元アプリのセッション Cookie（ログイン中に受け取ったもの）
 *   - Discord Webhook URL
 *   - 既に見た通知 id / 件数（二重送信防止）
 *
 * 平文では置かず、SESSION_SECRET で seal する。Discord をオフにしたら消す。
 */

import { seal, unseal } from './session.js';

const PREFIX = 'sub:';
const MAX_SEEN = 200;

export function subKey(id) {
  return `${PREFIX}${id}`;
}

export function newSubscriptionId() {
  return crypto.randomUUID();
}

/** Cron / 購読 API が扱う購読レコード。 */
export function normalizeSubscription(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.id || !raw.cookie || !raw.webhookUrl) return null;
  return {
    id: String(raw.id),
    cookie: String(raw.cookie),
    webhookUrl: String(raw.webhookUrl),
    primed: Boolean(raw.primed),
    count: Number.isFinite(raw.count) ? raw.count : 0,
    seenIds: Array.isArray(raw.seenIds)
      ? raw.seenIds.map(String).slice(0, MAX_SEEN)
      : [],
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
    lastOkAt: raw.lastOkAt || null,
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    disabled: Boolean(raw.disabled)
  };
}

export async function putSubscription(env, record) {
  const sub = normalizeSubscription(record);
  if (!sub) throw new Error('購読レコードが不正です');
  const token = await seal(sub, env.SESSION_SECRET);
  await env.NOTIFY_SUBS.put(subKey(sub.id), token);
  return sub;
}

export async function getSubscription(env, id) {
  if (!id) return null;
  const token = await env.NOTIFY_SUBS.get(subKey(id));
  if (!token) return null;
  return normalizeSubscription(await unseal(token, env.SESSION_SECRET));
}

export async function deleteSubscription(env, id) {
  if (!id) return;
  await env.NOTIFY_SUBS.delete(subKey(id));
}

/** 一覧。値は封印トークンなので 1 件ずつ解く。 */
export async function listSubscriptions(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.NOTIFY_SUBS.list({ prefix: PREFIX, cursor });
    for (const key of page.keys || []) {
      const token = await env.NOTIFY_SUBS.get(key.name);
      if (!token) continue;
      const sub = normalizeSubscription(await unseal(token, env.SESSION_SECRET));
      if (sub) out.push(sub);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/** ログイン中のセッションから購読を作る / 更新する。 */
export function buildSubscription({
  id, cookie, webhookUrl, prev = null, now = new Date()
}) {
  const iso = now.toISOString();
  return normalizeSubscription({
    id: id || newSubscriptionId(),
    cookie,
    webhookUrl,
    primed: prev?.primed ?? false,
    count: prev?.count ?? 0,
    seenIds: prev?.seenIds ?? [],
    createdAt: prev?.createdAt || iso,
    updatedAt: iso,
    lastOkAt: prev?.lastOkAt ?? null,
    lastError: null,
    disabled: false
  });
}
