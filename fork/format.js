/* 表示用の整形。日付・金額・期限の残り。 */

const DAY_MS = 86400000;

export const pad = (n) => String(n).padStart(2, '0');

export function parseIso(iso) {
  return iso ? new Date(`${iso}T00:00:00`) : null;
}

export function fmtDate(iso) {
  const d = parseIso(iso);
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export function fmtShort(iso) {
  const d = parseIso(iso);
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export function fmtTime(isoDateTime) {
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 金額。数値が取れなければ元の文字列をそのまま返す（勝手に 0 にしない）。 */
export function fmtYen(value, fallback = '') {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `¥${value.toLocaleString('ja-JP')}`;
  }
  return fallback;
}

/** 期限の残り。元データから導けるので新しい事実を作っていない。 */
export function dueRest(iso, today) {
  if (!iso) return null;
  const due = parseIso(iso);
  if (!due || Number.isNaN(due.getTime())) return null;
  const days = Math.round((due - today) / DAY_MS);
  if (days < 0) return { tone: 'over', glyph: '△', text: `${Math.abs(days)}日超過` };
  if (days === 0) return { tone: 'over', glyph: '△', text: '本日締切' };
  if (days <= 7) return { tone: 'soon', glyph: '', text: `残り${days}日` };
  return { tone: 'far', glyph: '', text: `残り${days}日` };
}
