/* Cron から回す Discord バックグラウンド配信。
 *
 * 各購読について元アプリの未読を取り、新しいものだけ Discord へ送る。
 * ブラウザの Watcher と同じ差分ロジック（pickNewNotifications）を使う。
 */

import { forwardDiscord } from './discord.js';
import { ApiError, html, unreadCount } from './meister.js';
import { parseNotifications } from './parse-pages.js';
import { listSubscriptions, putSubscription } from './subscribe.js';

/** クライアントの notify.js と同じ判定。Worker 側に複製して依存を切る。 */
export function pickNewNotifications({ prev, count, notifications }) {
  const items = Array.isArray(notifications) ? notifications : [];
  const seen = new Set((prev.seenIds || []).map(String));
  const countGrew = typeof count === 'number' && count > (prev.count || 0);

  const candidates = items.filter((n) => {
    if (!n || n.id == null) return false;
    if (n.read === true) return false;
    return !seen.has(String(n.id));
  });

  if (!prev.primed) {
    return {
      notify: false,
      items: [],
      next: {
        primed: true,
        count: typeof count === 'number' ? count : items.filter((n) => n.read === false).length,
        seenIds: mergeSeenIds(prev.seenIds, items.map((n) => n.id))
      }
    };
  }

  const shouldNotify = countGrew || candidates.length > 0;
  const fresh = shouldNotify ? candidates : [];

  return {
    notify: fresh.length > 0,
    items: fresh,
    next: {
      primed: true,
      count: typeof count === 'number' ? count : (prev.count || 0) + fresh.length,
      seenIds: mergeSeenIds(prev.seenIds, [
        ...items.map((n) => n.id),
        ...fresh.map((n) => n.id)
      ])
    }
  };
}

function mergeSeenIds(prev, ids) {
  const out = [];
  const set = new Set();
  for (const id of [...(ids || []), ...(prev || [])]) {
    if (id == null) continue;
    const key = String(id);
    if (set.has(key)) continue;
    set.add(key);
    out.push(key);
    if (out.length >= 200) break;
  }
  return out;
}

const DISCORD_COLOR = 0x2f6fed;

export function buildDiscordPayload(items, { origin } = {}) {
  const list = (items || []).slice(0, 5);
  const embeds = list.map((n) => {
    const embed = {
      title: String(n.title || '新しい通知').slice(0, 256),
      color: DISCORD_COLOR,
      footer: { text: 'Meister Management System（バックグラウンド）' }
    };
    if (n.body) embed.description = String(n.body).slice(0, 4096);
    if (n.atISO && !Number.isNaN(Date.parse(n.atISO))) {
      embed.timestamp = new Date(n.atISO).toISOString();
    }
    if (origin) embed.url = `${String(origin).replace(/\/$/, '')}/notifications`;
    return embed;
  });

  const more = (items || []).length - list.length;
  const content = more > 0
    ? `Meister に新しい通知が ${(items || []).length} 件あります（ほか ${more} 件）`
    : `Meister に新しい通知が ${(items || []).length} 件あります`;

  return { username: 'MMS', content, embeds };
}

/** 1 購読を処理する。結果の購読レコード（保存用）を返す。 */
export async function processSubscription(sub, env, {
  unreadCountFn = unreadCount,
  htmlFn = html,
  forwardFn = forwardDiscord,
  origin = 'https://meister-reports-fork.mitac31709.workers.dev',
  now = () => new Date()
} = {}) {
  if (!sub || sub.disabled) {
    return { sub, sent: 0, skipped: true };
  }

  try {
    const { count } = await unreadCountFn(sub.cookie);
    const n = typeof count === 'number' ? count : 0;

    let list = [];
    try {
      const body = await htmlFn(sub.cookie, '/notifications');
      list = parseNotifications(body).notifications || [];
    } catch (e) {
      // 件数は取れても一覧が取れないときは件数だけで進めない（誤爆防止）
      throw e;
    }

    const result = pickNewNotifications({
      prev: { primed: sub.primed, count: sub.count, seenIds: sub.seenIds },
      count: n,
      notifications: list
    });

    let sent = 0;
    if (result.notify && result.items.length) {
      const payload = buildDiscordPayload(result.items, { origin });
      const forwarded = await forwardFn(sub.webhookUrl, payload);
      if (!forwarded.ok) {
        throw new Error(`Discord ${forwarded.status}`);
      }
      sent = result.items.length;
    }

    const next = {
      ...sub,
      ...result.next,
      updatedAt: now().toISOString(),
      lastOkAt: now().toISOString(),
      lastError: null,
      disabled: false
    };
    return { sub: next, sent, skipped: false };
  } catch (e) {
    const message = e instanceof ApiError
      ? `${e.status}: ${e.message}`
      : (e.message || String(e));
    const authFailed = e instanceof ApiError && e.status === 401;
    const next = {
      ...sub,
      updatedAt: now().toISOString(),
      lastError: message.slice(0, 300),
      // セッション失効は止める。Webhook 失敗は次の Cron で再試行。
      disabled: authFailed
    };
    return { sub: next, sent: 0, skipped: false, error: message };
  }
}

export async function runBackgroundNotify(env, deps = {}) {
  const subs = await listSubscriptions(env);
  const summary = { checked: 0, sent: 0, errors: 0, disabled: 0 };

  for (const sub of subs) {
    summary.checked += 1;
    const result = await processSubscription(sub, env, deps);
    await putSubscription(env, result.sub);
    summary.sent += result.sent || 0;
    if (result.error) summary.errors += 1;
    if (result.sub.disabled) summary.disabled += 1;
  }

  return summary;
}
