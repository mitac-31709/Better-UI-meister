/* 注文一覧。
 *
 * 週報一覧（`reports.js`）と同じ作りにしてある。表・絞り込み・並べ替え・
 * 詳細パネルの挙動を画面ごとに変えると、行き来したときに覚え直しになる。
 *
 * 週報との違いは 3 つ。
 *  1. 期限が無いので、既定の並びは作成日の新しい順。
 *  2. 書き込み口が無いので、詳細は読み取りだけ。削除も編集も置かない。
 *  3. 「新しい注文」は元アプリの作成画面へ送る。このフォークにフォームは無い。
 */

import { api } from '../api.js';
import { demoOrders } from '../demo.js';
import { fmtDate, fmtYen } from '../format.js';
import { dataTable, emptyBlock, h, metaList, panel, statusPill } from '../ui.js';

export const meta = { route: '/orders', nav: '注文', title: '注文' };

const NEW_ORDER_URL = 'https://meister.tokyo-ct.org/orders/new';
const SORT_KEYS = [
  'product', 'unitPriceValue', 'quantityValue', 'totalValue', 'status', 'createdAt'
];
const state = { q: '', status: 'all', sortKey: 'createdAt', sortDir: 'desc', selectedId: null };

const numeric = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function load(ctx) {
  return ctx.demo ? demoOrders() : api.orders();
}

export function render(data, ctx) {
  const rows = (data.orders || []).map(normalize);
  const emptyText = data.empty || { title: '注文がありません', body: '' };

  readUrl();

  const listHost = h('div', { class: 'list' });
  const countEl = h('p', {
    class: 'toolbar__count', id: 'result-count', role: 'status', 'aria-live': 'polite'
  });
  const summary = h('dl', { class: 'summary' });

  const page = h('div', {},
    h('header', { class: 'page-head' },
      h('h1', { class: 'page-head__title', text: meta.title }),
      summary,
      h('button', {
        class: 'btn btn--primary', type: 'button', id: 'new-order', onclick: openNewOrder
      }, '新しい注文')),
    buildToolbar(),
    listHost);

  paint();
  if (state.selectedId != null) openDetail(state.selectedId, { focus: false });
  return page;

  // ── 状態 ────────────────────────────────────────
  function normalize(o) {
    return {
      id: o.id,
      product: o.product || '',
      status: o.status || '',
      unitPriceValue: numeric(o.unitPriceValue),
      quantityValue: numeric(o.quantityValue),
      totalValue: numeric(o.totalValue),
      // 数値にできない値は元の文字列を残す。¥0 と書くと元データと違うことになる。
      unitPriceText: fmtYen(o.unitPriceValue, o.unitPrice || '—'),
      totalText: fmtYen(o.totalValue, o.total || '—'),
      quantityText: o.quantity
        || (numeric(o.quantityValue) != null ? String(o.quantityValue) : '—'),
      createdISO: o.createdAtISO ?? null,
      createdText: o.createdAt || fmtDate(o.createdAtISO)
    };
  }

  function sortValue(o) {
    switch (state.sortKey) {
      case 'product': return o.product;
      case 'status': return o.status;
      case 'createdAt': return o.createdISO || o.createdText;
      default: return o[state.sortKey];   // 金額と数量は数値のまま比べる
    }
  }

  function filtering() {
    return state.q.trim() !== '' || state.status !== 'all';
  }

  function visible() {
    const q = state.q.trim().toLowerCase();
    const dir = state.sortDir === 'asc' ? 1 : -1;
    return rows
      .filter((o) => {
        if (state.status !== 'all' && o.status !== state.status) return false;
        if (q && !o.product.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const x = sortValue(a);
        const y = sortValue(b);
        if (x === y) return (a.id ?? 0) - (b.id ?? 0);
        // 値が取れなかった行は向きによらず末尾に置く。先頭に来ると読み始めが空になる。
        if (x == null) return 1;
        if (y == null) return -1;
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
        return (String(x) > String(y) ? 1 : -1) * dir;
      });
  }

  // ── URL 同期。リンクを共有できる状態を保つ ─────────
  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.q = p.get('q') || '';
    const status = p.get('status');
    state.status = status === '未完了' || status === '完了' ? status : 'all';
    const key = p.get('sort_by');
    if (SORT_KEYS.includes(key)) state.sortKey = key;
    state.sortDir = p.get('sort_direction') === 'asc' ? 'asc' : 'desc';
    const id = Number(p.get('order_id'));
    state.selectedId = Number.isFinite(id) && id > 0 ? id : null;
  }

  function syncUrl() {
    const p = new URLSearchParams();
    if (state.q.trim()) p.set('q', state.q.trim());
    if (state.status !== 'all') p.set('status', state.status);
    p.set('sort_by', state.sortKey);
    p.set('sort_direction', state.sortDir);
    if (state.selectedId) p.set('order_id', state.selectedId);
    if (ctx.demo) p.set('demo', '1');
    history.replaceState(null, '', `${location.pathname}?${p}`);
  }

  // ── ツールバー ──────────────────────────────────
  function buildToolbar() {
    const search = h('input', {
      class: 'input', type: 'search', id: 'q', name: 'q',
      placeholder: 'アルミ', autocomplete: 'off', 'aria-describedby': 'q-hint',
      value: state.q,
      oninput: (e) => { state.q = e.target.value; paint(); syncUrl(); }
    });

    const segments = [['all', 'すべて'], ['未完了', '未完了'], ['完了', '完了']]
      .map(([value, label]) => h('label', { class: 'segmented__option' },
        h('input', {
          type: 'radio', name: 'status', value,
          checked: state.status === value,
          onchange: (e) => {
            if (!e.target.checked) return;
            state.status = value;
            paint();
            syncUrl();
          }
        }),
        h('span', {}, label)));

    const sortSelect = h('select', {
      class: 'input select', id: 'sort', name: 'sort',
      onchange: (e) => {
        const [key, dir] = e.target.value.split(':');
        state.sortKey = key;
        state.sortDir = dir;
        paint();
        syncUrl();
      }
    }, [
      ['createdAt:desc', '作成が新しい順'], ['createdAt:asc', '作成が古い順'],
      ['totalValue:desc', '合計が大きい順'], ['totalValue:asc', '合計が小さい順'],
      ['product:asc', '商品名順']
    ].map(([value, label]) => h('option', {
      value, selected: value === `${state.sortKey}:${state.sortDir}`
    }, label)));

    return h('div', { class: 'toolbar' },
      h('div', { class: 'field field--search' },
        h('label', { class: 'field__label', for: 'q', text: '商品名で絞り込み' }),
        search,
        h('p', { class: 'field__hint', id: 'q-hint' }, h('kbd', { text: '/' }), ' で移動')),
      h('fieldset', { class: 'field field--status' },
        h('legend', { class: 'field__label', text: 'ステータス' }),
        h('div', { class: 'segmented' }, segments),
        h('p', { class: 'field__hint', 'aria-hidden': 'true' }, '\u00a0')),
      h('div', { class: 'field field--sort' },
        h('label', { class: 'field__label', for: 'sort', text: '並べ替え' }),
        h('span', { class: 'select-wrap' }, sortSelect),
        h('p', { class: 'field__hint', 'aria-hidden': 'true' }, '\u00a0')),
      countEl);
  }

  // ── 描画 ────────────────────────────────────────
  function paint() {
    const list = visible();

    if (list.length) {
      listHost.replaceChildren(dataTable({
        caption: '注文の一覧。列見出しのボタンで並べ替えできます。行を開くと右に詳細が出ます。',
        columns: [
          // 列幅は既存の指定（--status 7rem / --created 8rem）を数の列に流用する。
          { key: 'product', label: '商品', className: 'table__th--title' },
          { key: 'unitPriceValue', label: '単価', className: 'table__th--status' },
          { key: 'quantityValue', label: '数量', className: 'table__th--status' },
          { key: 'totalValue', label: '合計', className: 'table__th--status' },
          { key: 'status', label: 'ステータス', className: 'table__th--status' },
          { key: 'createdAt', label: '作成日', className: 'table__th--created' }
        ],
        sort: { key: state.sortKey, dir: state.sortDir },
        onSort: (key) => {
          state.sortDir = state.sortKey === key && state.sortDir === 'asc' ? 'desc' : 'asc';
          state.sortKey = key;
          paint();
          syncUrl();
          listHost.querySelector(`.sort-btn[data-sort="${key}"]`)?.focus();
        },
        rows: list.map((o) => ({
          id: o.id,
          idPrefix: 'order',        // 元 UI の行 ID 規約を保つ
          selected: o.id === state.selectedId,
          onOpen: (id) => openDetail(id),
          cells: [
            { label: '商品', value: o.product },
            { label: '単価', value: o.unitPriceText, className: 'cell--num' },
            { label: '数量', value: o.quantityText, className: 'cell--num' },
            { label: '合計', value: o.totalText, className: 'cell--num' },
            { label: 'ステータス', value: statusPill(o.status) },
            { label: '作成日', value: o.createdText, className: 'cell--num' }
          ]
        }))
      }));
      wireKeyboard();
    } else {
      // 絞り込みで 0 件になったのか、そもそも 0 件なのかを言い分ける
      listHost.replaceChildren(filtering()
        ? emptyBlock({
          title: '条件に合う注文がありません',
          body: '検索語やステータスを変えてみてください。',
          actionLabel: '絞り込みを解除',
          onAction: resetFilters
        })
        : emptyBlock(emptyText));
    }

    countEl.textContent = filtering()
      ? `${list.length} / ${rows.length} 件`
      : `${rows.length} 件`;

    const counts = {
      未完了: rows.filter((o) => o.status === '未完了').length,
      完了: rows.filter((o) => o.status === '完了').length,
      合計: rows.length
    };
    summary.replaceChildren(...[
      ['未完了', counts.未完了, ''],
      ['完了', counts.完了, ''],
      ['合計', counts.合計, 'summary__item--total']
    ].map(([label, value, extra]) => h('div', { class: `summary__item ${extra}`.trim() },
      h('dt', { class: 'summary__label', text: label }),
      h('dd', { class: 'summary__value', text: String(value) }))));
  }

  function resetFilters() {
    state.q = '';
    state.status = 'all';
    const input = listHost.parentElement?.querySelector('#q');
    if (input) input.value = '';
    listHost.parentElement?.querySelectorAll('input[name="status"]')
      .forEach((r) => { r.checked = r.value === 'all'; });
    paint();
    syncUrl();
    input?.focus();
  }

  function wireKeyboard() {
    const body = listHost.querySelector('#rows');
    if (!body) return;
    body.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'j' && e.key !== 'k') return;
      e.preventDefault();
      const buttons = [...body.querySelectorAll('.row__open')];
      if (!buttons.length) return;
      const delta = e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1;
      const current = buttons.indexOf(document.activeElement);
      const next = current < 0 ? 0
        : Math.min(buttons.length - 1, Math.max(0, current + delta));
      buttons[next].focus();
    });
  }

  // ── 詳細パネル。元アプリに書き込み口が無いので読むだけ ──
  function openDetail(id, { focus = true } = {}) {
    const o = rows.find((x) => x.id === id);
    if (!o) return;

    state.selectedId = id;
    paint();
    syncUrl();

    panel.open({
      eyebrow: '注文',
      title: o.product,
      body: metaList([
        ['商品', o.product || '—'],
        ['単価', o.unitPriceText],
        ['数量', o.quantityText],
        ['合計', o.totalText],
        ['ステータス', statusPill(o.status)],
        ['作成日', o.createdText || '—']
      ]),
      actions: [
        h('button', {
          class: 'btn btn--secondary', type: 'button', id: 'panel-cancel',
          onclick: () => panel.close()
        }, '閉じる')
      ],
      onClose: () => {
        state.selectedId = null;
        paint();
        syncUrl();
        // フォーカスを呼び出した行へ返す
        return listHost.querySelector(`#order_${id} .row__open`);
      }
    });

    if (!focus) document.activeElement?.blur?.();
  }

  // 作成フォーム（`/orders/new`）はこのフォークに含めていない。
  // リンクを死なせるより、どこへ行けば作れるのかをその場で言う。
  function openNewOrder() {
    panel.open({
      eyebrow: '注文',
      title: '新しい注文',
      body: h('p', { class: 'disclaimer' },
        'このフォークは注文の一覧だけを作り直したもので、作成フォームは含めていません。'
        + 'ここでは注文を作れません。作成は元アプリの /orders/new で行ってください。'
        + '下のボタンで別のタブに開きます。'),
      actions: [
        h('a', {
          class: 'btn btn--primary', id: 'panel-new-order',
          href: NEW_ORDER_URL, target: '_blank', rel: 'noopener'
        }, '元アプリで注文を作成'),
        h('button', {
          class: 'btn btn--secondary', type: 'button', id: 'panel-cancel',
          onclick: () => panel.close()
        }, '閉じる')
      ]
    });
  }
}
