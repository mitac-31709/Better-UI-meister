/* ダッシュボード。
 *
 * 他の画面と同じ形（meta / load / render）で揃えている。
 *
 * 元アプリのこの画面は、見出しとチーム名の下が `<h1>調整中</h1>` の 1 行だけで
 * 中身が無い。埋めるための集計を作ると嘘になるので、
 *  1. 「まだ中身が無い」ことをそのまま出す。
 *  2. 代わりに他の画面への入口だけを置く。件数や割合は data に無いので書かない。
 */

import { api } from '../api.js';
import { demoDashboard } from '../demo.js';
import { h } from '../ui.js';

export const meta = { route: '/dashboard', nav: 'ダッシュボード', title: 'ダッシュボード' };

// 添える一行は「何が置いてある画面か」だけ。数字は出さない。
const SHORTCUTS = [
  ['/reports', '週報', '毎週の提出'],
  ['/orders', '注文', '物品の購入'],
  ['/equipments', '機材', '貸出できる機材'],
  ['/loans', '貸出', '申請と返却'],
  ['/notifications', '通知', '届いた知らせ']
];

export async function load(ctx, opts = {}) {
  return ctx.demo ? demoDashboard(opts) : api.dashboard(opts);
}

export function render(data, ctx) {
  const team = data.team || '';
  const notice = data.notice || '';

  const shortcuts = h('div', { class: 'itemlist' }, SHORTCUTS.map(([route, label, note]) =>
    h('button', {
      class: 'item item--button', type: 'button', dataset: { route },
      onclick: () => ctx.navigate(route)
    },
    h('span', { class: 'item__title', text: label }),
    h('span', { class: 'item__meta', text: note }))));

  return h('div', {},
    h('header', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-head__title', text: data.heading || 'ダッシュボード' }),
        team ? h('p', { class: 'page-head__lede', text: team }) : null)),
    // 注記と入口は別の塊。間隔は .sections の gap から取り、空の要素は挟まない。
    h('div', { class: 'sections' },
      notice ? h('p', { class: 'notice' },
        h('span', { class: 'notice__glyph', 'aria-hidden': 'true', text: '…' }),
        `${notice} · 元アプリでもこの区画にはまだ中身がありません`) : null,
      shortcuts),
    h('p', {
      class: 'disclaimer',
      text: ctx.demo
        ? 'これは UI 改善の検証用のフォークです。表示しているデータはダミーで、'
          + 'ダッシュボードは元アプリでも「調整中」の 1 行だけなので、'
          + 'ここに集計は置いていません。'
        : 'これは UI 改善の検証用のフォークです。ダッシュボードは元アプリでも'
          + '見出しとチーム名の下が「調整中」の 1 行だけで、集計は取得できません。'
          + '数字を作らずそのまま出しています。'
    }));
}
