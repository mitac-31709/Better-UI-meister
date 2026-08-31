/* 元アプリの `/reports` の HTML を JSON に変換する。
 *
 * Meister Management System は Rails のサーバサイドレンダリングで、週報一覧に
 * JSON の口が無い（`/reports` は HTML を返す）。JSON API を持つのは
 * `/notifications/unread_count` だけ。そのため一覧はここで HTML から組み立てる。
 *
 * ネットワークに触らない純関数だけを置く。実際に取得した HTML
 * （`../clone/site/auth/reports.html`）に対して test/parse.test.mjs で検証する。
 *
 * 注意: 集計と空状態の文言と列見出しは実物で検証済み。**行と詳細は未検証**。
 * クローンを取得したアカウントは週報が 0 件で、データが入った行も詳細 frame も
 * 一度も見ていない。行の形は公開されている Stimulus の実装
 * （`id="report_<id>"` で行を引く）と列見出しの順序から組んだもの。
 * 詳細は `turbo-frame#side_panel` と `data-field-name`（collaborative_edit）に合わせる。
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

/** 開始位置から、同じタグの入れ子を数えて閉じタグまでを切り出す */
function sliceFrom(html, start, tag) {
  const re = new RegExp(`<${tag}\\b|</${tag}\\s*>`, 'gi');
  re.lastIndex = start;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return { inner: html.slice(start, m.index), end: re.lastIndex };
  }
  return { inner: html.slice(start), end: html.length };
}

function unescapeAttr(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function headingText(html, level) {
  const m = html.match(new RegExp(`<${level}\\b[^>]*>([\\s\\S]*?)</${level}>`, 'i'));
  return m ? text(m[1]) || null : null;
}

/** `#side_panel` の Turbo Frame があれば中身、無ければ HTML 全体。
 *  元アプリは一覧から `src="/reports/:id"` でこの frame に詳細を載せる。 */
export function extractSidePanel(html) {
  if (!html) return '';
  const openRe = /<turbo-frame\b[^>]*\bid="side_panel"[^>]*>/i;
  const open = openRe.exec(html);
  if (!open) return html;
  return sliceFrom(html, open.index + open[0].length, 'turbo-frame').inner;
}

function findFieldLabel(html, fieldId, fieldIndex) {
  if (fieldId) {
    const escaped = fieldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const forRe = new RegExp(
      `<label\\b[^>]*\\bfor="${escaped}"[^>]*>([\\s\\S]*?)</label>`,
      'i'
    );
    const m = html.match(forRe);
    if (m) return text(m[1]) || null;
  }
  const before = html.slice(Math.max(0, fieldIndex - 1200), fieldIndex);
  const labels = [...before.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)];
  if (labels.length) return text(labels[labels.length - 1][1]) || null;
  const heads = [...before.matchAll(/<(h[2-4])\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  if (heads.length) return text(heads[heads.length - 1][2]) || null;
  return null;
}

/** `data-field-name` を持つ入力。collaborative_edit_controller が使う印。 */
export function parseReportFields(html) {
  const out = [];
  const seen = new Set();
  const openRe = /<(\w+)\b([^>]*\bdata-field-name="([^"]+)"[^>]*)>/gi;
  let m;
  while ((m = openRe.exec(html))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const name = m[3];
    if (!name || seen.has(name)) continue;
    seen.add(name);

    let value = '';
    if (tag === 'input' || tag === 'select') {
      value = unescapeAttr((attrs.match(/\bvalue="([^"]*)"/) || [])[1] || '');
    } else if (tag === 'textarea') {
      const { inner } = sliceFrom(html, m.index + m[0].length, 'textarea');
      value = unescapeAttr(inner);
    } else {
      const { inner } = sliceFrom(html, m.index + m[0].length, tag);
      const nestedTa = inner.match(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/i);
      const nestedIn = inner.match(/<input\b([^>]*)>/i);
      if (nestedTa) value = unescapeAttr(nestedTa[1]);
      else if (nestedIn) {
        value = unescapeAttr((nestedIn[1].match(/\bvalue="([^"]*)"/) || [])[1] || '');
      } else {
        continue;
      }
    }

    const id = (attrs.match(/\bid="([^"]+)"/) || [])[1] || null;
    out.push({
      name,
      label: findFieldLabel(html, id, m.index),
      value,
      lockedBy: null
    });
  }

  // data-field-name が無いときの Rails フォーム。実 HTML では未検証。
  if (!out.length) {
    const nameRe = /<(textarea|input)\b([^>]*\bname="report\[([^\]]+)\]"[^>]*)>/gi;
    while ((m = nameRe.exec(html))) {
      const tag = m[1].toLowerCase();
      const attrs = m[2];
      const name = m[3];
      if (!name || seen.has(name) || name === 'id') continue;
      seen.add(name);
      let value = '';
      if (tag === 'textarea') {
        const { inner } = sliceFrom(html, m.index + m[0].length, 'textarea');
        value = unescapeAttr(inner);
      } else {
        value = unescapeAttr((attrs.match(/\bvalue="([^"]*)"/) || [])[1] || '');
      }
      const id = (attrs.match(/\bid="([^"]+)"/) || [])[1] || null;
      out.push({
        name,
        label: findFieldLabel(html, id, m.index),
        value,
        lockedBy: null
      });
    }
  }
  return out;
}

function parseInitialLocks(html) {
  const m = html.match(/data-collaborative-edit-initial-locks-value="([^"]*)"/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(unescapeAttr(m[1]));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseDefinitionList(html) {
  const out = [];
  const re = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  let m;
  while ((m = re.exec(html))) {
    const label = text(m[1]);
    const value = text(m[2]);
    if (!label) continue;
    out.push({ label, value: value || null });
  }
  return out;
}

function parseTimeline(html) {
  const out = [];
  const openRe = /<(\w+)\b[^>]*class="[^"]*\btimeline-item\b[^"]*"[^>]*>/gi;
  let m;
  while ((m = openRe.exec(html))) {
    const { inner, end } = sliceFrom(html, m.index + m[0].length, m[1]);
    const time = inner.match(/<time\b([^>]*)>([\s\S]*?)<\/time>/i);
    const datetime = time ? (time[1].match(/datetime="([^"]*)"/) || [])[1] : null;
    const at = time ? text(time[2]) || null : null;
    let body = text(time ? inner.replace(time[0], ' ') : inner) || null;
    out.push({
      at,
      atISO: datetime && /^\d{4}-\d{2}-\d{2}/.test(datetime) ? datetime.slice(0, 10) : toIso(at),
      text: body
    });
    openRe.lastIndex = end;
  }
  return out;
}

/** `/reports/:id` の詳細。
 *  **未検証（実 HTML）**: クローン時は週報 0 件で詳細 frame を取れていない。
 *  鍵は元アプリ JS が使う `turbo-frame#side_panel` と `data-field-name`
 *  （`collaborative_edit_controller` / `user_report_sidebar_controller`）。
 *  項目名は HTML の label を素通しし、語彙を作らない。 */
export function parseReportDetail(html) {
  const frame = extractSidePanel(html);
  const idMatch = frame.match(/data-collaborative-edit-report-id-value="(\d+)"/)
    || frame.match(/\bid="report_(\d+)"/)
    || html.match(/\/reports\/(\d+)/);
  const fields = parseReportFields(frame);
  const locks = parseInitialLocks(frame);
  for (const lock of locks) {
    const fieldName = lock?.field_name || lock?.fieldName;
    const userName = lock?.user_name || lock?.userName || null;
    if (!fieldName || !userName) continue;
    const field = fields.find((f) => f.name === fieldName);
    if (field && !field.lockedBy) field.lockedBy = userName;
  }
  const body = fields.map((f) => f.value).filter((v) => v && v.trim()).join('\n\n') || null;
  const locked = fields.find((f) => f.lockedBy);
  return {
    id: idMatch ? Number(idMatch[1]) : null,
    title: headingText(frame, 'h2') || headingText(frame, 'h1') || headingText(frame, 'h3'),
    meta: parseDefinitionList(frame),
    fields,
    timeline: parseTimeline(frame),
    body,
    lockedBy: locked?.lockedBy || null
  };
}
