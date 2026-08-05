/* 元アプリ（Meister Management System）へのアクセス。
 *
 * 元アプリは Rails のサーバサイドレンダリングで、JSON を返すのは
 * `/notifications/unread_count` だけ。他の画面は HTML を取って parse 側で JSON にする。
 *
 * セッションは**利用者ごと**。Worker 側に共有のログイン状態を持たない。
 * 誰かのセッションを他の利用者に見せないため、ここではキャッシュを一切しない。
 */

import { authenticityToken, looksLikeSignIn } from './parse.js';

export const ORIGIN = 'https://meister.tokyo-ct.org';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export class ApiError extends Error {
  /** clearSession: この 401 でブラウザの Cookie も落とすか。
   *  資格情報の入力ミスで既存のセッションを壊さないため、既定は false。 */
  constructor(status, message, { clearSession = false } = {}) {
    super(message);
    this.status = status;
    this.clearSession = clearSession;
  }
}

function sessionCookieFrom(response) {
  const jar = [];
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    if (pair && pair.startsWith('_meister_management_system_session=')) jar.push(pair);
  }
  return jar.length ? jar[jar.length - 1] : null;
}

async function origin(path, init = {}, cookie) {
  const headers = {
    'User-Agent': UA,
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    ...(init.headers || {})
  };
  if (cookie) headers.Cookie = cookie;
  return fetch(`${ORIGIN}${path}`, { ...init, headers, redirect: 'manual' });
}

/** 利用者の資格情報で元アプリにログインし、セッション Cookie を返す。
 *  資格情報はここから先に持ち出さない（保存もしない）。 */
export async function signIn(email, password) {
  if (!email || !password) {
    throw new ApiError(400, 'メールアドレスとパスワードを入力してください');
  }

  const formPage = await origin('/users/sign_in', { headers: { Accept: 'text/html' } });
  if (formPage.status !== 200) {
    throw new ApiError(502, `元アプリのサインイン画面が ${formPage.status} を返しました`);
  }
  const preCookie = sessionCookieFrom(formPage);
  const token = authenticityToken(await formPage.text());
  if (!token) throw new ApiError(502, '元アプリの authenticity_token が見つかりません');

  const body = new URLSearchParams({
    authenticity_token: token,
    remember: 'true',
    'user[email]': email,
    'user[password]': password,
    'user[remember_me]': '0',
    commit: 'ログイン'
  });

  const posted = await origin('/users/sign_in', {
    method: 'POST',
    body: body.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html',
      Origin: ORIGIN,
      Referer: `${ORIGIN}/users/sign_in`
    }
  }, preCookie);

  // 成功は 3xx（Rails 7 + Turbo は 303）。失敗は 422 だが理由が 2 通りある。
  if (posted.status === 422) {
    const html = await posted.text();
    if (html.includes('メールアドレスまたはパスワードが違います')) {
      throw new ApiError(401, 'メールアドレスまたはパスワードが違います。');
    }
    if (/InvalidAuthenticityToken|authenticity/i.test(html)) {
      throw new ApiError(502, 'CSRF トークンが通りませんでした（セッション Cookie が送れていない）');
    }
    throw new ApiError(502, `ログインが 422 で失敗しました（本文の先頭: ${html.slice(0, 120)}）`);
  }

  const redirected = posted.status >= 300 && posted.status < 400;
  const cookie = sessionCookieFrom(posted) || preCookie;
  if (!redirected || !cookie) {
    throw new ApiError(502, `元アプリのログイン応答が想定外です（${posted.status}）`);
  }
  return cookie;
}

/** 元アプリからログアウトする。
 *
 * 元アプリのセッションは Rails の cookie_store で、中身が Cookie 自体に入っている。
 * そのためサインアウトしても**発行済みの Cookie 値は無効にならない**
 * （実測: サインアウト後に古い Cookie で `/reports` を叩くと 200 が返る）。
 * サーバ側に破棄できる状態が無いので、これは元アプリの性質でここでは直せない。
 *
 * ここでできるのは、サインアウトを element として成立させ、
 * こちらが持っている Cookie を匿名のものに差し替えることまで。
 * 併せて自ドメインの Cookie を消し（呼び出し側）、封印トークンの有効期限を
 * 短くしてある（`session.js`）。結果は握り潰さず応答に載せる。
 */
export async function signOut(cookie) {
  try {
    const page = await origin('/dashboard', { headers: { Accept: 'text/html' } }, cookie);
    const html = await page.text();
    const token = authenticityToken(html);
    if (!token) {
      return { ok: false, reason: `authenticity_token が取れない（/dashboard が ${page.status}）` };
    }

    // Rails のセッションは Cookie に入っていて応答ごとに再発行される。
    // CSRF トークンはその応答で返った Cookie と対なので、更新されていれば
    // そちらを使う。元の Cookie で投げると 422 になる。
    const fresh = sessionCookieFrom(page) || cookie;

    const res = await origin('/users/sign_out', {
      method: 'POST',
      body: new URLSearchParams({ _method: 'delete', authenticity_token: token }).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
        Origin: ORIGIN,
        Referer: `${ORIGIN}/dashboard`
      }
    }, fresh);

    if (res.status >= 400) {
      return { ok: false, reason: `/users/sign_out が ${res.status}` };
    }

    // サインアウトが通ったかは、応答で返る新しい Cookie が匿名になっているかで見る。
    // 古い Cookie 値が死んだかは見ない（cookie_store なので死なない）。
    const after = sessionCookieFrom(res);
    if (!after || after === fresh) {
      return { ok: false, reason: 'サインアウト後もセッション Cookie が差し替わらない' };
    }

    const probe = await origin('/reports', { headers: { Accept: 'text/html' } }, after);
    const location = probe.headers.get('Location') || '';
    const anonymous = probe.status >= 300 && probe.status < 400
      && location.includes('/users/sign_in');
    return anonymous
      ? { ok: true }
      : { ok: false, reason: `差し替わった Cookie でも /reports が ${probe.status}` };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
}

/** ログイン済みのセッションで GET する。
 *  失効していたら 401 を投げる（利用者に再ログインしてもらう）。 */
export async function get(cookie, path, accept = 'text/html') {
  const res = await origin(path, { headers: { Accept: accept } }, cookie);

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('Location') || '';
    if (location.includes('/users/sign_in')) {
      throw new ApiError(401, 'ログインの有効期限が切れました。もう一度ログインしてください。',
        { clearSession: true });
    }
    return { status: res.status, redirectedTo: location, body: '' };
  }

  const body = await res.text();
  if (looksLikeSignIn(body)) {
    throw new ApiError(401, 'ログインの有効期限が切れました。もう一度ログインしてください。',
      { clearSession: true });
  }
  return { status: res.status, redirectedTo: null, body };
}

/** HTML を取る。200 以外は例外にする。 */
export async function html(cookie, path) {
  const res = await get(cookie, path);
  if (res.status !== 200) {
    throw new ApiError(502, `元アプリの ${path} が ${res.status} を返しました`
      + (res.redirectedTo ? `（→ ${res.redirectedTo}）` : ''));
  }
  return res.body;
}

/** 元アプリが唯一 JSON で返す口。 */
export async function unreadCount(cookie) {
  const res = await get(cookie, '/notifications/unread_count', 'application/json');
  if (res.status !== 200) {
    throw new ApiError(502, `元アプリの /notifications/unread_count が ${res.status} を返しました`);
  }
  try {
    return JSON.parse(res.body);
  } catch {
    throw new ApiError(502, '未読通知数の応答が JSON ではありません');
  }
}
