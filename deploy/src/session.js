/* 利用者ごとのセッション。
 *
 * 元アプリの Rails セッション Cookie は HttpOnly かつ SameSite=Lax なので、
 * 別オリジンのブラウザからは送れない。そこで Worker が代わりに持つ。
 *
 * Worker 側に状態を置かず、Rails の Cookie を AES-GCM で暗号化して
 * 自ドメインの Cookie に入れる。鍵は `SESSION_SECRET`。
 * 平文の資格情報は保存しない。ログインのときに元アプリへ中継するだけ。
 */

const COOKIE = 'mms_session';
/* 元アプリは cookie_store なのでサインアウトで発行済み Cookie を無効化できない。
   露出する時間を短くするため、封印トークン側の期限を短く切る。 */
const MAX_AGE = 4 * 60 * 60;
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
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    // 鍵替え・改竄・期限切れはすべて「ログインしていない」として扱う
    return null;
  }
}

export function readCookie(request) {
  const header = request.headers.get('Cookie') || '';
  const m = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

export function setCookieHeader(token) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookieHeader() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export const SESSION_MAX_AGE_MS = MAX_AGE * 1000;

/** ログイン中の利用者を返す。していなければ null。 */
export async function currentSession(request, env) {
  const token = readCookie(request);
  if (!token) return null;
  return unseal(token, env.SESSION_SECRET);
}
