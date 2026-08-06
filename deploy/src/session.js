/* 利用者ごとのセッション。
 *
 * 元アプリの Rails セッション Cookie は HttpOnly かつ SameSite=Lax なので、
 * 別オリジンのブラウザからは送れない。そこで Worker が代わりに持つ。
 *
 * Worker 側に状態を置かず、Rails の Cookie を AES-GCM で暗号化して
 * 自ドメインの Cookie に入れる。鍵は `SESSION_SECRET`。
 * 平文の資格情報は保存しない。ログインのときに元アプリへ中継するだけ。
 *
 * 封印トークン側に独自の有効期限は付けない。実効の失効は元アプリの
 * セッションとログアウト、鍵の差し替えに委ねる。
 */

const COOKIE = 'mms_session';
/* ブラウザが Cookie を保持する上限。Chromium 系の実用上限に合わせる。
   以前の 4 時間制限は撤廃済み。期限切れ判定は封印ペイロードでは行わない。 */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;
const ENC = new TextEncoder();
const DEC = new TextDecoder();

function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(value) {
  const s = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

async function key(secret) {
  if (!secret) throw new Error('SESSION_SECRET が設定されていません');
  const digest = await crypto.subtle.digest('SHA-256', ENC.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false,
    ['encrypt', 'decrypt']);
}

export async function seal(payload, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = ENC.encode(JSON.stringify(payload));
  const box = await crypto.subtle.encrypt({ name: 'AES-GCM', iv },
    await key(secret), data);
  return `${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(box))}`;
}

export async function unseal(token, secret) {
  const [ivPart, boxPart] = String(token).split('.');
  if (!ivPart || !boxPart) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64urlDecode(ivPart) },
      await key(secret), b64urlDecode(boxPart));
    const payload = JSON.parse(DEC.decode(plain));
    if (!payload?.cookie) return null;
    // 旧トークンに付いていた exp は無視する（4 時間制限の撤廃）
    return payload;
  } catch {
    // 鍵替え・改竄は「ログインしていない」として扱う
    return null;
  }
}

export function readCookie(request) {
  const header = request.headers.get('Cookie') || '';
  const m = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

export function setCookieHeader(token) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookieHeader() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/** ログイン中の利用者を返す。していなければ null。 */
export async function currentSession(request, env) {
  const token = readCookie(request);
  if (!token) return null;
  return unseal(token, env.SESSION_SECRET);
}
