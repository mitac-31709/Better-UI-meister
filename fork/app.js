/* フォークの入口。認証・ルーティング・シェルの配線だけを持つ。
 * 各画面の中身は `pages/*.js` にある。
 *
 * データは Worker の `/api/*` から取る。元アプリは Rails のサーバサイド
 * レンダリングで JSON をほとんど返さないので、Worker が HTML を JSON にしている。
 * `?demo=1` を付けたときと、`/api/*` が無い静的配信のときは同梱のデモデータに落ちる。
 */

import { Unauthenticated, api } from './api.js';
import { DEMO_USER, demoNotifications } from './demo.js';
import { fmtTime } from './format.js';
import {
  badgeLabel, clearState, createWatcher, loadPrefs, savePrefs, showBrowserNotification
} from './notify.js';
import { h, panel, wirePanel } from './ui.js';

import * as dashboard from './pages/dashboard.js';
import * as orders from './pages/orders.js';
import * as equipments from './pages/equipments.js';
import * as loans from './pages/loans.js';
import * as reports from './pages/reports.js';
import * as notifications from './pages/notifications.js';

const PAGES = [dashboard, orders, equipments, loans, reports, notifications];
const BY_ROUTE = new Map(PAGES.map((p) => [p.meta.route, p]));
const DEFAULT_ROUTE = '/dashboard';

const el = {
  signin: document.getElementById('signin'),
  signinForm: document.getElementById('signin-form'),
  signinError: document.getElementById('signin-error'),
  signinSubmit: document.getElementById('signin-submit'),
  app: document.getElementById('app'),
  view: document.getElementById('view'),
  source: document.getElementById('data-source'),
  badge: document.getElementById('notification-badge'),
  userName: document.getElementById('user-name'),
  userMeta: document.getElementById('user-meta'),
  logout: document.getElementById('logout'),
  navToggle: document.getElementById('nav-toggle'),
  nav: document.getElementById('rail-nav')
};

/** デモモードかどうかは URL で決める。以後の画面遷移でも維持する。 */
const isDemo = () => new URLSearchParams(location.search).get('demo') === '1';

const ctx = {
  get demo() { return isDemo(); },
  today: new Date(),
  navigate,
  reload: () => render(currentRoute())
};
ctx.today.setHours(0, 0, 0, 0);

// ── データの出どころ表示 ──────────────────────────────
function setSource(kind, note) {
  el.source.dataset.kind = kind;
  el.source.textContent = note;
  el.source.hidden = false;
}

function noteFor(data) {
  if (ctx.demo) return ['demo', 'デモデータ（?demo=1）'];
  if (data?.source === 'live') {
    const at = fmtTime(data.fetchedAt);
    return ['live', `元アプリのデータ${at ? ` · ${at} 取得` : ''}`];
  }
  return ['demo', 'デモデータ'];
}

// ── ルーティング ────────────────────────────────────
function currentRoute() {
  const path = location.pathname.replace(/\/+$/, '') || DEFAULT_ROUTE;
  return BY_ROUTE.has(path) ? path : DEFAULT_ROUTE;
}

function keepQuery(path) {
  const params = new URLSearchParams(location.search);
  const keep = new URLSearchParams();
  if (params.get('demo') === '1') keep.set('demo', '1');
  const q = keep.toString();
  return q ? `${path}?${q}` : path;
}

function navigate(path, { replace = false } = {}) {
  // パネルは URL を書き換える前に閉じる。閉じる処理が自分の画面の
  // クエリを同期するので、後で閉じると遷移先の URL に混ざる。
  panel.close({ silent: true });
  const url = keepQuery(path);
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  render(currentRoute());
}

function markNav(route) {
  document.querySelectorAll('.rail__link[data-route]').forEach((link) => {
    const active = link.dataset.route === route;
    link.classList.toggle('is-current', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function errorBlock(message, onRetry) {
  return h('div', { class: 'empty' },
    h('p', { class: 'empty__title', text: '読み込めませんでした' }),
    h('p', { class: 'empty__body', text: message }),
    h('button', {
      class: 'btn btn--secondary empty__reset', type: 'button', onclick: onRetry
    }, 'もう一度試す'));
}

let renderToken = 0;

async function render(route) {
  const page = BY_ROUTE.get(route);
  if (!page) return;

  const token = ++renderToken;
  markNav(route);
  panel.close({ silent: true });
  document.title = `${page.meta.title} — Meister Management System`;
  el.view.replaceChildren(h('p', { class: 'loading', text: '読み込み中…' }));

  let data;
  try {
    data = await page.load(ctx);
  } catch (e) {
    if (token !== renderToken) return;
    if (e instanceof Unauthenticated) return showSignIn(e.message);
    el.view.replaceChildren(errorBlock(e.message, () => render(route)));
    setSource('demo', `元アプリから取得できず（${e.message}）`);
    return;
  }
  if (token !== renderToken) return;

  const [kind, note] = noteFor(data);
  setSource(kind, note);
  el.view.replaceChildren(page.render(data, ctx));
}

// ── ログイン ────────────────────────────────────────
function showSignIn(message) {
  el.app.hidden = true;
  el.signin.hidden = false;
  el.source.hidden = true;
  if (message) {
    el.signinError.textContent = message;
    el.signinError.hidden = false;
  }
  document.title = 'ログイン — Meister Management System';
  document.getElementById('email').focus();
}

function showApp(user) {
  el.signin.hidden = true;
  el.app.hidden = false;
  el.userName.textContent = user?.name || '';
  el.userMeta.textContent = user?.badge ? `権限 ${user.badge}` : '';
  startNotifyWatcher();
}

el.signinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  el.signinError.hidden = true;
  el.signinSubmit.dataset.state = 'loading';
  try {
    const { user } = await api.login(email, password);
    document.getElementById('password').value = '';
    showApp(user);
    navigate(currentRoute(), { replace: true });
  } catch (err) {
    el.signinError.textContent = err.message;
    el.signinError.hidden = false;
    document.getElementById('password').select();
  } finally {
    delete el.signinSubmit.dataset.state;
  }
});

el.logout.addEventListener('click', async () => {
  stopNotifyWatcher();
  clearState();
  const prefs = loadPrefs();
  if (prefs.subscriptionId) {
    try {
      await api.unsubscribeNotify(prefs.subscriptionId);
    } catch {
      // ベストエフォート
    }
    savePrefs({ ...prefs, subscriptionId: null, discord: false });
  }

  // デモモードのログアウトはデモを抜ける。?demo=1 を残すとまた入ってしまう。
  // 静的配信では boot が ?demo=1 に戻すので、遷移せずログイン画面を出す。
  if (ctx.demo) {
    history.replaceState(null, '', '/dashboard');
    showSignIn(null);
    return;
  }

  try {
    await api.logout();
  } catch {
    // 元アプリ側のログアウトが失敗しても、こちらのセッションは落とす
  }
  location.href = '/dashboard';
});

// ── 変更通知の監視 ──────────────────────────────────
function setBadge(count) {
  const label = badgeLabel(count);
  if (label) {
    el.badge.textContent = label;
    el.badge.hidden = false;
  } else {
    el.badge.hidden = true;
  }
}

const watcher = createWatcher({
  origin: location.origin,
  getPrefs: loadPrefs,
  isVisible: () => document.visibilityState !== 'hidden',
  onBadge: setBadge,
  unreadCount: async () => {
    if (ctx.demo) {
      const unread = demoNotifications().notifications.filter((n) => n.read === false).length;
      return { count: unread };
    }
    const result = await api.unreadCount();
    // ポーリングのついでに購読の Cookie を更新（タブを閉じたあともしばらく使えるように）
    refreshBackgroundSubscription();
    return result;
  },
  notifications: async () => {
    if (ctx.demo) return demoNotifications();
    return api.notifications();
  },
  showBrowser: showBrowserNotification,
  sendDiscord: async (payload, webhookUrl) => {
    if (ctx.demo) {
      try {
        await api.notifyDiscord(webhookUrl, payload);
      } catch (e) {
        if (e instanceof Unauthenticated) {
          throw new Error('Discord へ送るにはログインが必要です（Worker 経由）');
        }
        throw e;
      }
      return;
    }
    await api.notifyDiscord(webhookUrl, payload);
  }
});

// 通知画面の届け先設定から参照する。
ctx.watcher = watcher;

/** タブが開いている間、購読の Rails Cookie を書き戻して寿命を延ばす。 */
async function refreshBackgroundSubscription() {
  if (ctx.demo) return;
  const prefs = loadPrefs();
  if (!prefs.discord || !prefs.subscriptionId) return;
  try {
    await api.refreshNotifySubscription(prefs.subscriptionId);
  } catch {
    // 失効や欠落は次の保存で作り直す
  }
}

function startNotifyWatcher() {
  watcher.stop();
  watcher.start();
  refreshBackgroundSubscription();
}

function stopNotifyWatcher() {
  watcher.stop();
}

// ── シェルの配線 ────────────────────────────────────
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-route]');
  if (!link) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(link.dataset.route);
  el.nav.classList.remove('is-open');
  el.navToggle.setAttribute('aria-expanded', 'false');
});

window.addEventListener('popstate', () => render(currentRoute()));

el.navToggle.addEventListener('click', () => {
  const open = el.nav.classList.toggle('is-open');
  el.navToggle.setAttribute('aria-expanded', String(open));
});

wirePanel();

// ── 起動 ───────────────────────────────────────────
async function boot() {
  if (ctx.demo) {
    showApp(DEMO_USER);
    render(currentRoute());
    return;
  }

  try {
    const { user } = await api.me();
    showApp(user);
    render(currentRoute());
  } catch (e) {
    if (e instanceof Unauthenticated) {
      showSignIn(null);
      return;
    }
    // `/api` が無い静的配信ではログインできない。デモに落として理由を出す。
    showApp(DEMO_USER);
    setSource('demo', `デモデータ · 元アプリに接続できず（${e.message}）`);
    history.replaceState(null, '', `${currentRoute()}?demo=1`);
    render(currentRoute());
  }
}

boot();
