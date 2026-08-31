/* パーサを、実際に取得した HTML に対して検証する。
 *
 *   node --test test/parse.test.mjs
 *
 * 集計・列見出し・空状態は実物（clone/site/auth/reports.html）で確かめる。
 * 行の構造は実物に 1 件も無いため、実 HTML の tbody に合成した行を差し込んで
 * 確かめる。この差分は README と parse.js に明記してある。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseReportsPage, parseCounts, parseColumns, parseEmptyState,
  parseRows, parseReportDetail, extractSidePanel, toIso, splitRange,
  looksLikeSignIn, authenticityToken, text
} from '../src/parse.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPORTS = join(here, '../../clone/site/auth/reports.html');
const SIGN_IN = join(here, '../../clone/site/public/users/sign_in.html');

const html = readFileSync(REPORTS, 'utf8');
const signInHtml = readFileSync(SIGN_IN, 'utf8');

test('実 HTML から列見出しを 5 つ取れる', () => {
  const columns = parseColumns(html);
  assert.deepEqual(columns.map((c) => c.label),
    ['タイトル', '期間', 'ステータス', '期限', '作成日']);
});

test('実 HTML から集計を取れる', () => {
  assert.deepEqual(parseCounts(html), { 未完了: 0, 完了: 0, 合計: 0 });
});

test('実 HTML から空状態の文言を取れる', () => {
  assert.deepEqual(parseEmptyState(html), {
    title: '週報がありません',
    body: '管理者によって新しいレポートの締め切りが設定されると、ここにレポートが表示されます。'
  });
});

test('実 HTML の行は 0 件（取得したアカウントに週報が無い）', () => {
  assert.equal(parseReportsPage(html).reports.length, 0);
});

test('ログイン画面を判別できる', () => {
  assert.equal(looksLikeSignIn(signInHtml), true);
  assert.equal(looksLikeSignIn(html), false);
});

test('authenticity_token を取り出せる', () => {
  const token = authenticityToken(signInHtml);
  assert.equal(typeof token, 'string');
  assert.ok(token.length > 40, `token が短い: ${token}`);
});

test('日付を ISO に寄せられる', () => {
  assert.equal(toIso('2026/08/05'), '2026-08-05');
  assert.equal(toIso('2026-8-5'), '2026-08-05');
  assert.equal(toIso('2026年8月5日'), '2026-08-05');
  assert.equal(toIso('08/05'), null);              // 年が無いので補えない
  assert.equal(toIso('08/05', '2026'), '2026-08-05');
  assert.equal(toIso(''), null);
});

test('期間の両端を分けられる', () => {
  assert.deepEqual(splitRange('05/04 – 05/10'), ['05/04', '05/10']);
  assert.deepEqual(splitRange('2026/05/04 - 2026/05/10'), ['2026/05/04', '2026/05/10']);
  assert.deepEqual(splitRange(''), [null, null]);
});

test('タグを落としてテキストにできる', () => {
  assert.equal(text('<span class="a">✓ 完了</span>'), '✓ 完了');
  assert.equal(text('<td>\n  2026/08/05\n  <span>△ 本日締切</span>\n</td>'),
    '2026/08/05 △ 本日締切');
});

// ── 行の構造は実物に無いので、実 HTML の tbody に合成して確かめる ──
const SYNTHETIC_ROWS = `
  <tr id="report_114" class="hover">
    <td class="py-4 px-6"><a href="/reports/114">第14週 週報</a></td>
    <td class="py-4 px-6">07/27 – 08/02</td>
    <td class="py-4 px-6"><span class="badge">未完了</span></td>
    <td class="py-4 px-6">2026/08/05</td>
    <td class="py-4 px-6">2026/07/28</td>
  </tr>
  <tr id="report_113" class="hover">
    <td class="py-4 px-6"><a href="/reports/113">第13週 週報</a></td>
    <td class="py-4 px-6">07/20 – 07/26</td>
    <td class="py-4 px-6"><span class="badge">完了</span></td>
    <td class="py-4 px-6">2026/07/29</td>
    <td class="py-4 px-6">2026/07/21</td>
  </tr>
`;

const populated = html.replace(
  /(<tbody\b[^>]*>)([\s\S]*?)(<\/tbody>)/,
  (_all, open, _inner, close) => `${open}${SYNTHETIC_ROWS}${close}`
);

test('行を取れる（合成した行で検証）', () => {
  const parsed = parseReportsPage(populated);
  assert.equal(parsed.reports.length, 2);

  const [first, second] = parsed.reports;
  assert.equal(first.id, 114);
  assert.equal(first.title, '第14週 週報');
  assert.equal(first.period, '07/27 – 08/02');
  assert.equal(first.status, '未完了');
  assert.equal(first.due, '2026/08/05');
  assert.equal(first.createdAt, '2026/07/28');
  assert.equal(first.dueISO, '2026-08-05');
  assert.equal(first.createdAtISO, '2026-07-28');
  // 期間は年を省いた表記。期限の年で補う。
  assert.equal(first.periodStartISO, '2026-07-27');
  assert.equal(first.periodEndISO, '2026-08-02');

  assert.equal(second.id, 113);
  assert.equal(second.status, '完了');
});

test('行があっても集計と列見出しは壊れない', () => {
  const parsed = parseReportsPage(populated);
  assert.deepEqual(parsed.counts, { 未完了: 0, 完了: 0, 合計: 0 });
  assert.equal(parsed.columns.length, 5);
});

test('ステータスの前に付くグリフを落とす', () => {
  const withGlyph = html.replace(
    /(<tbody\b[^>]*>)([\s\S]*?)(<\/tbody>)/,
    (_a, open, _b, close) => `${open}
      <tr id="report_1">
        <td>第1週 週報</td><td>04/06 – 04/12</td>
        <td><span>✓ 完了</span></td><td>2026/04/15</td><td>2026/04/07</td>
      </tr>${close}`
  );
  assert.equal(parseRows(withGlyph, parseColumns(withGlyph))[0].status, '完了');
});

// ── 詳細。実 HTML が無いので Stimulus の印に合わせた合成 HTML で検証する ──
const SYNTHETIC_DETAIL = `
<html><body>
<main>
  <turbo-frame id="side_panel">
    <div data-controller="collaborative-edit"
         data-collaborative-edit-report-id-value="114"
         data-collaborative-edit-current-user-id-value="1"
         data-collaborative-edit-current-user-name-value="三谷 慧介"
         data-collaborative-edit-initial-locks-value="[{&quot;field_name&quot;:&quot;next_week&quot;,&quot;user_id&quot;:2,&quot;user_name&quot;:&quot;岸 洋輔&quot;}]">
      <h2>第14週 週報</h2>
      <dl>
        <dt>期間</dt><dd>07/27 – 08/02</dd>
        <dt>ステータス</dt><dd>未完了</dd>
        <dt>期限</dt><dd>2026/08/05</dd>
      </dl>
      <div>
        <label for="report_content">今週の活動</label>
        <textarea id="report_content" data-collaborative-edit-target="field"
                  data-field-name="content">位置決め精度の測定をやり直し中。</textarea>
      </div>
      <div>
        <label for="report_next_week">来週の予定</label>
        <textarea id="report_next_week" data-collaborative-edit-target="field"
                  data-field-name="next_week">検査データをまとめる。</textarea>
      </div>
      <div class="timeline">
        <div class="timeline-item">
          <time datetime="2026-07-28">2026/07/28</time>
          作成されました
        </div>
      </div>
    </div>
  </turbo-frame>
</main>
</body></html>
`;

test('詳細の Turbo Frame を切り出せる', () => {
  const inner = extractSidePanel(SYNTHETIC_DETAIL);
  assert.match(inner, /collaborative-edit/);
  assert.doesNotMatch(inner, /<main/);
});

test('詳細から項目・メタ・履歴・ロックを取れる（合成 HTML）', () => {
  const parsed = parseReportDetail(SYNTHETIC_DETAIL);
  assert.equal(parsed.id, 114);
  assert.equal(parsed.title, '第14週 週報');
  assert.deepEqual(parsed.meta.map((m) => m.label), ['期間', 'ステータス', '期限']);
  assert.equal(parsed.fields.length, 2);
  assert.equal(parsed.fields[0].name, 'content');
  assert.equal(parsed.fields[0].label, '今週の活動');
  assert.equal(parsed.fields[0].value, '位置決め精度の測定をやり直し中。');
  assert.equal(parsed.fields[1].name, 'next_week');
  assert.equal(parsed.fields[1].label, '来週の予定');
  assert.equal(parsed.fields[1].lockedBy, '岸 洋輔');
  assert.equal(parsed.lockedBy, '岸 洋輔');
  assert.equal(parsed.timeline.length, 1);
  assert.equal(parsed.timeline[0].atISO, '2026-07-28');
  assert.match(parsed.timeline[0].text, /作成/);
});

test('frame が無い詳細 HTML でも項目を取れる', () => {
  const parsed = parseReportDetail(`
    <h2>週報</h2>
    <label for="a">本文</label>
    <textarea id="a" data-field-name="content">hello &amp; world</textarea>
  `);
  assert.equal(parsed.fields[0].value, 'hello & world');
  assert.equal(parsed.fields[0].label, '本文');
});
