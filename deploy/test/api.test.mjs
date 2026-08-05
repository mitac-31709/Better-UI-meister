/* Worker の API を、実際に動いているエンドポイントに対して検証する。
 *
 *   node --test test/api.test.mjs                          # 既定は wrangler dev
 *   BASE=https://... node --test test/api.test.mjs          # 本番に対して
 *
 * 元アプリに実際にログインするので資格情報が必要。環境変数から読む。
 *   MEISTER_EMAIL / MEISTER_PASSWORD（または Meister_MailAddress / Meister_Password）
 *
 * 認証は利用者ごと。Worker は資格情報を持たず、元アプリのセッション Cookie を
 * 暗号化して自ドメインの Cookie に入れるだけ。
 *
 * 取得したアカウントはどのリストも 0 件なので、件数は 0 を期待する。
 * 中身が入ったら各 `items` の形も検証する。
 */

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

const BASE = (process.env.BASE || 'http://127.0.0.1:8788').replace(/\/$/, '');
const EMAIL = process.env.MEISTER_EMAIL || process.env.Meister_MailAddress;
const PASSWORD = process.env.MEISTER_PASSWORD || process.env.Meister_Password;

if (!EMAIL || !PASSWORD) {
  throw new Error('MEISTER_EMAIL / MEISTER_PASSWORD が必要です');
}

let cookie = null;

const get = (path, init = {}) => fetch(`${BASE}${path}`, {
  ...init,
  headers: {
    Accept: 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
    ...(init.headers || {})
  },
  redirect: 'manual'
});

/** セッションを送らない版。共有変数を書き換えないため別に持つ。 */
const getNoAuth = (path, init = {}) => fetch(`${BASE}${path}`, {
  ...init,
  headers: { Accept: 'application/json', ...(init.headers || {}) },
  redirect: 'manual'
});

const login = (email, password) => fetch(`${BASE}/api/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ email, password }),
  redirect: 'manual'
});

// 1 つのセッションを共有するので直列に走らせる。並行だと
// Cookie を使うテストと使わないテストが混ざって落ちる（本番で実際に踏んだ）。
describe('Worker API', { concurrency: 1 }, () => {

before(async () => {
  const res = await login(EMAIL, PASSWORD);
  assert.equal(res.status, 200, `ログインに失敗: ${await res.clone().text()}`);
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
});

test('/api/health は資格情報を持たず利用者ごとの認証だと報告する', async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.auth, 'per-user');
  assert.equal(body.sessionSecret, true, 'SESSION_SECRET が未設定');
  assert.equal(body.credentials, undefined,
    'Worker が元アプリの資格情報を持ってしまっている');
});

test('セッション無しでは全ての取得口が 401', async () => {
  for (const path of ['/api/me', '/api/dashboard', '/api/reports', '/api/orders',
    '/api/equipments', '/api/loans', '/api/notifications',
    '/api/notifications/unread_count']) {
    const res = await getNoAuth(path);
    assert.equal(res.status, 401, `${path} が ${res.status}`);
    assert.equal((await res.json()).code, 'unauthenticated', `${path} の code`);
  }
});

test('誤った資格情報は元アプリの文言をそのまま返す', async () => {
  const res = await login(EMAIL, 'definitely-not-the-password');
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /メールアドレスまたはパスワードが違います/);
  assert.equal(res.headers.get('set-cookie'), null, '失敗したのに Cookie を焼いている');
});

test('メールアドレスかパスワードが空なら 400', async () => {
  assert.equal((await login('', PASSWORD)).status, 400);
  assert.equal((await login(EMAIL, '')).status, 400);
});

test('ログインで焼く Cookie は HttpOnly / Secure / SameSite=Lax', async () => {
  const res = await login(EMAIL, PASSWORD);
  const raw = res.headers.get('set-cookie') || '';
  assert.match(raw, /^mms_session=/);
  assert.match(raw, /HttpOnly/);
  assert.match(raw, /Secure/);
  assert.match(raw, /SameSite=Lax/);
});

test('/api/me は元アプリから読んだ表示名を返す', async () => {
  const res = await get('/api/me');
  assert.equal(res.status, 200);
  const { user } = await res.json();
  assert.ok(user.name && user.name.trim(), `表示名が空: ${JSON.stringify(user)}`);
});

test('改竄した Cookie は 401 になり、こちらの Cookie も落とす', async () => {
  const res = await getNoAuth('/api/reports', { headers: { Cookie: 'mms_session=aaaa.bbbb' } });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('set-cookie') || '', /mms_session=;/);
});

test('/api/dashboard', async () => {
  const body = await (await get('/api/dashboard')).json();
  assert.equal(body.source, 'live');
  assert.equal(body.heading, 'ダッシュボード');
  assert.match(body.team, /^チーム:/);
  assert.ok(body.notice, '調整中の表示が取れていない');
});

test('/api/reports は列見出しと集計と空状態を元 HTML から取る', async () => {
  const body = await (await get('/api/reports')).json();
  assert.equal(body.source, 'live');
  assert.deepEqual(body.columns.map((c) => c.label),
    ['タイトル', '期間', 'ステータス', '期限', '作成日']);
  for (const k of ['未完了', '完了', '合計']) {
    assert.equal(typeof body.counts[k], 'number', `counts.${k}`);
  }
  assert.equal(body.empty.title, '週報がありません');
  assert.equal(body.reports.length, body.counts.合計, '行数と合計が食い違う');
  for (const r of body.reports) {
    assert.ok(['未完了', '完了'].includes(r.status), `想定外のステータス: ${r.status}`);
  }
});

test('/api/orders は列見出し 6 つと空状態を取る', async () => {
  const body = await (await get('/api/orders')).json();
  assert.equal(body.source, 'live');
  assert.deepEqual(body.columns.map((c) => c.label),
    ['商品', '単価', '数量', '合計', 'ステータス', '作成日']);
  assert.equal(body.empty.title, '注文がありません');
  assert.ok(Array.isArray(body.orders));
  for (const o of body.orders) {
    for (const k of ['unitPriceValue', 'quantityValue', 'totalValue']) {
      assert.ok(o[k] === null || typeof o[k] === 'number',
        `${k} が数値でも null でもない: ${o[k]}`);
      assert.ok(!Number.isNaN(o[k]), `${k} が NaN`);
    }
  }
});

test('/api/equipments', async () => {
  const body = await (await get('/api/equipments')).json();
  assert.equal(body.source, 'live');
  assert.equal(body.heading, '利用可能な機材');
  assert.equal(body.lede, '貸出申請可能な機材一覧');
  assert.match(body.empty.text, /現在利用可能な機材はありません/);
  assert.ok(Array.isArray(body.equipments));
});

test('/api/loans は描画されている節だけを返す', async () => {
  const body = await (await get('/api/loans')).json();
  assert.equal(body.source, 'live');
  assert.equal(body.heading, '機材貸出');
  assert.deepEqual(body.sections.map((s) => s.key), ['pending', 'active']);
  assert.deepEqual(body.sections.map((s) => s.title), ['申請中', '貸出中']);
  for (const s of body.sections) assert.ok(Array.isArray(s.items));
});

test('/api/notifications', async () => {
  const body = await (await get('/api/notifications')).json();
  assert.equal(body.source, 'live');
  assert.equal(body.heading, '通知');
  assert.equal(body.empty.title, '通知はありません');
  assert.ok(Array.isArray(body.notifications));
  for (const n of body.notifications) {
    assert.ok(n.read === null || typeof n.read === 'boolean',
      `read が boolean でも null でもない: ${n.read}`);
  }
});

test('/api/notifications/unread_count は元アプリの JSON をそのまま通す', async () => {
  const body = await (await get('/api/notifications/unread_count')).json();
  assert.equal(typeof body.count, 'number');
});

test('知らない口は 404、取得口に POST は 405', async () => {
  assert.equal((await get('/api/nope')).status, 404);
  const posted = await get('/api/reports', { method: 'POST' });
  assert.equal(posted.status, 405);
  assert.equal(posted.headers.get('allow'), 'GET');
});

test('/api/session は POST と DELETE 以外を拒む', async () => {
  const res = await get('/api/session');
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST, DELETE');
});

test('画面はログイン前でも配られる（ログイン画面を出すため）', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Meister Management System/);
  assert.match(body, /id="signin"/);
});

test('失敗したログインは既存のセッションを壊さない', async () => {
  const before = (await get('/api/me')).status;
  assert.equal(before, 200);
  await login(EMAIL, 'definitely-not-the-password');
  assert.equal((await get('/api/me')).status, 200,
    'ログインを間違えたら既存のセッションが落ちた');
});

// 最後に流す。以降のテストはセッションを使えない。
test('ログアウトで Cookie が落ち、元アプリ側のサインアウトも通る', async () => {
  const res = await get('/api/session', { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie') || '', /mms_session=;/,
    'こちらの Cookie を消していない');

  const body = await res.json();
  assert.equal(body.originSignedOut, true,
    `元アプリのサインアウトが通っていない: ${body.reason}`);

  // 元アプリは Rails の cookie_store なので、発行済みの Cookie 値は
  // サインアウトしても無効にならない。実測で確認済みの元アプリの性質であり、
  // ここで直せるものではない。ブラウザは Set-Cookie に従うのでログアウトできる。
  // 手元に値を持ち続けた場合は封印トークンの期限まで有効。
  const stillWorks = await get('/api/reports');
  assert.equal(stillWorks.status, 200,
    '元アプリの挙動が変わった可能性がある。README の但し書きを見直すこと');
});

});
