/* 機材貸出。
 *
 * 元アプリは「申請中」「貸出中」のような区画を縦に並べ、区画ごとに空状態の
 * 文言を持つ。どの区画があるかはデータ側が決めるので、こちらで数を決め打ちせず
 * 来た順にそのまま並べる。1 件の詳細を出す画面は元アプリにも無いので作らない。
 */

import { api } from '../api.js';
import { demoLoans } from '../demo.js';
import { h } from '../ui.js';

export const meta = { route: '/loans', nav: '貸出', title: '機材貸出' };

export async function load(ctx) {
  return ctx.demo ? demoLoans() : api.loans();
}

export function render(data) {
  const sections = data.sections || [];

  return h('div', {},
    h('header', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-head__title', text: data.heading || meta.title }),
        data.lede ? h('p', { class: 'page-head__lede', text: data.lede }) : null)),
    h('div', { class: 'sections' }, sections.map(section)));
}

function section(s) {
  const items = s.items || [];

  return h('section', {},
    h('div', { class: 'section__head' },
      h('h2', { class: 'section__title', text: s.title || '' }),
      h('p', { class: 'section__count', text: `${items.length} 件` })),
    items.length
      ? h('div', { class: 'itemlist' }, items.map((item) => h('div', { class: 'item' },
        h('span', { class: 'item__title', text: item.name || '—' }),
        item.meta ? h('span', { class: 'item__meta', text: item.meta }) : null)))
      : h('p', { class: 'section__empty', text: s.empty || '' }));
}
