/* 元アプリの `/reports` の HTML を JSON に変換する。
 *
 * Meister Management System は Rails のサーバサイドレンダリングで、週報一覧に
 * JSON の口が無い（`/reports` は HTML を返す）。JSON API を持つのは
 * `/notifications/unread_count` だけ。そのため一覧はここで HTML から組み立てる。
 *
 * ネットワークに触らない純関数だけを置く。実際に取得した HTML
 * （`../clone/site/auth/reports.html`）に対して test/parse.test.mjs で検証する。
 *
 * 注意: 集計と空状態の文言と列見出しは実物で検証済み。**行の構造は未検証**。
 * クローンを取得したアカウントは週報が 0 件で、データが入った行を一度も見ていない。
 * 行の形は公開されている Stimulus の実装（`id="report_<id>"` で行を引く）と
 * 列見出しの順序から組んだもの。
 */

const TAG = /<[^>]*>/g;
const WS = /\s+/g;

/** タグを落として空白を詰める */
export function text(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(TAG, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(WS, ' ')
    .trim();
}

/** ログイン画面が返ってきていないか（セッション切れの判定に使う） */
export function looksLikeSignIn(html) {
  return /name="user\[password\]"/.test(html) || /action="\/users\/sign_in"/.test(html);
}

/** Devise のフォームから authenticity_token を取り出す */
export function authenticityToken(html) {
  const m = html.match(/name="authenticity_token"\s+value="([^"]+)"/);
  return m ? m[1] : null;
}

/** 集計チップ「未完了 0」「完了 0」「合計 0」 */
export function parseCounts(html) {
  const counts = { 未完了: null, 完了: null, 合計: null };
  const re = /<span>\s*(未完了|完了|合計)\s+(\d+)\s*<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    counts[m[1]] = Number(m[2]);
  }
  return counts;
}

/** 列見出し。ソート可否の判定にも使えるよう data-column があれば拾う */
export function parseColumns(html) {
  const thead = html.match(/<thead[\s\S]*?<\/thead>/);
  if (!thead) return [];
  const out = [];
  const re = /<th\b([^>]*)>([\s\S]*?)<\/th>/g;
  let m;
  while ((m = re.exec(thead[0]))) {
    const label = text(m[2]);
    if (!label) continue;
    const column = m[1].match(/data-column="([^"]+)"/);
    out.push(column ? { label, column: column[1] } : { label });
  }
  return out;
}

/** 空状態の見出しと本文 */
export function parseEmptyState(html) {
  const m = html.match(/<h3\b[^>]*>([^<]+)<\/h3>\s*<p\b[^>]*>([^<]+)<\/p>/);
  if (!m) return null;
  return { title: text(m[1]), body: text(m[2]) };
}

/** 「2026/07/22」「2026-07-22」「07/22」を ISO(YYYY-MM-DD) に寄せる。
 *  年が無い表記は年を補えないので null を返す。 */
export function toIso(value, fallbackYear) {
  if (!value) return null;
  const ymd = value.match(/(\d{4})\s*[\/年.-]\s*(\d{1,2})\s*[\/月.-]\s*(\d{1,2})/);
  if (ymd) {
    const [, y, mo, d] = ymd;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const md = value.match(/^\s*(\d{1,2})\s*[\/月.-]\s*(\d{1,2})/);
  if (md && fallbackYear) {
    const [, mo, d] = md;
    return `${fallbackYear}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

/** 「05/04 – 05/10」「2026/05/04 - 2026/05/10」の両端を返す */
export function splitRange(value) {
  if (!value) return [null, null];
  const parts = value.split(/[–—~〜\-]|から|to/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return [value.trim() || null, null];
  return [parts[0], parts[parts.length - 1]];
}

/** tbody の行を配列にする。列は見出しの順（タイトル/期間/ステータス/期限/作成日）。 */
export function parseRows(html, columns) {
  const tbody = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/);
  if (!tbody) return [];

  const labels = columns.map((c) => c.label);
  const rows = [];
  const trRe = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/g;
  let tr;
  while ((tr = trRe.exec(tbody[1]))) {
    const attrs = tr[1];
    const idMatch = attrs.match(/id="report_(\d+)"/);

    const cells = [];
    const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/g;
    let td;
    while ((td = tdRe.exec(tr[2]))) cells.push(text(td[1]));
    if (!cells.length) continue;

    const byLabel = {};
    labels.forEach((label, i) => { byLabel[label] = cells[i] ?? ''; });

    const title = byLabel['タイトル'] ?? cells[0] ?? '';
    const period = byLabel['期間'] ?? '';
    const status = byLabel['ステータス'] ?? '';
    const due = byLabel['期限'] ?? '';
    const createdAt = byLabel['作成日'] ?? '';

    const dueISO = toIso(due);
    const createdAtISO = toIso(createdAt);
    // 期間は年を省いた「05/04 – 05/10」形式が想定される。期限の年で補う。
    const year = (dueISO || createdAtISO || '').slice(0, 4) || null;
    const [from, to] = splitRange(period);

    rows.push({
      id: idMatch ? Number(idMatch[1]) : null,
      title,
      period,
      status: status.replace(/^[✓○]\s*/, ''),
      due,
      createdAt,
      dueISO,
      createdAtISO,
      periodStartISO: toIso(from, year),
      periodEndISO: toIso(to, year),
      cells
    });
  }
  return rows;
}

/** `/reports` の HTML 全体を JSON にする */
export function parseReportsPage(html) {
  const columns = parseColumns(html);
  return {
    columns,
    counts: parseCounts(html),
    empty: parseEmptyState(html),
    reports: parseRows(html, columns)
  };
}
