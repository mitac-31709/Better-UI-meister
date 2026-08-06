/* 利用可能な機材。
 *
 * 元アプリは 3 列のカードグリッドで、カードの中身は名称と補助行と申請ボタン。
 * 取得できたアカウントでは 0 件だったため、カードに何が載るかは名称以外
 * 確認できていない。無い項目は書かず、来た分だけ出す。
 */

import { api } from '../api.js';
import { demoEquipments } from '../demo.js';
import { emptyBlock, h } from '../ui.js';

export const meta = { route: '/equipments', nav: '機材', title: '利用可能な機材' };

const ORIGIN = 'https://meister.tokyo-ct.org';

export async function load(ctx, opts = {}) {
  return ctx.demo ? demoEquipments() : api.equipments(opts);
}

export function render(data) {
  const equipments = data.equipments || [];
  const emptyBody = data.empty?.text || '現在利用可能な機材はありません。';

  return h('div', {},
    h('header', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-head__title', text: data.heading || meta.title }),
        data.lede ? h('p', { class: 'page-head__lede', text: data.lede }) : null),
      h('dl', { class: 'summary' },
        h('div', { class: 'summary__item summary__item--total' },
          h('dt', { class: 'summary__label', text: '件数' }),
          h('dd', { class: 'summary__value', text: String(equipments.length) })))),
    equipments.length
      ? h('ul', { class: 'cards' }, equipments.map(card))
      : emptyBlock({ body: emptyBody }));
}

function card(item) {
  // action の形は実物を見ていない。ラベルと行き先が揃っているときだけ出す。
  const label = item.action?.label || null;
  const href = item.action?.href || null;

  return h('li', { class: 'card', id: item.id != null ? `equipment_${item.id}` : null },
    h('p', { class: 'card__title', text: item.name || '—' }),
    item.meta ? h('p', { class: 'card__meta', text: item.meta }) : null,
    label && href
      ? h('p', { class: 'card__foot' }, h('a', {
        class: 'btn btn--secondary', href: absolute(href), target: '_blank', rel: 'noopener'
      },
      // 申請の行き先は元アプリ。ここで完結すると思わせないよう、ラベルで先に言う。
      `元アプリで${label}`,
      h('span', { class: 'sr-only', text: '（別のタブで開きます）' })))
      : null);
}

/** フォークに申請の経路は無いので、相対リンクも元アプリ側として解決する。 */
function absolute(href) {
  return /^https?:/.test(href) ? href : `${ORIGIN}${href.startsWith('/') ? '' : '/'}${href}`;
}
