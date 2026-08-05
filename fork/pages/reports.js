/* 週報一覧。
 *
 * 他の画面もこの形に合わせている。
 *   meta   … ルートとナビ表示名と <title>
 *   load   … デモなら demo.js、実データなら api.js
 *   render … ノードを 1 つ返す。画面内の再描画は自分で持つ
 *
 * 元 UI との違いで意図的なものは 4 つ。
 *  1. 絞り込み・並べ替えでページを再読み込みしない。状態は URL に同期する。
 *  2. 詳細パネルは Escape と背景クリックで閉じ、フォーカスを呼び出した行へ返す。
 *  3. パネルを閉じても中身を捨てない。開き直しで再取得しない。
 *  4. 削除は確認ダイアログではなく、実行してから「元に戻す」を出す。
 */

import { api } from '../api.js';
import { DEMO_TODAY, demoReports } from '../demo.js';
import { dueRest, fmtDate, fmtShort } from '../format.js';
import { dataTable, dueCell, emptyBlock, h, metaList, panel, statusPill, toasts } from '../ui.js';

export const meta = { route: '/reports', nav: '週報', title: '週報一覧' };

const SORT_KEYS = ['title', 'periodStart', 'status', 'due', 'createdAt'];
const state = { q: '', status: 'all', sortKey: 'due', sortDir: 'asc', selectedId: null };

export async function load(ctx) {
  return ctx.demo ? demoReports() : api.reports();
}

export function render(data, ctx) {
  const today = ctx.demo ? new Date(`${DEMO_TODAY}T00:00:00`) : ctx.today;
  const editable = ctx.demo;          // 実データには書き込み口を用意していない

  let rows = (data.reports || []).map(normalize);
  const serverCounts = data.counts?.合計 != null ? data.counts : null;
  const emptyText = data.empty || { title: '週報がありません', body: '' };

  readUrl();

  const listHost = h('div', { class: 'list' });
  const countEl = h('p', {
    class: 'toolbar__count', id: 'result-count', role: 'status', 'aria-live': 'polite'
  });
  const summary = h('dl', { class: 'summary' });
  const disclaimer = h('p', { class: 'disclaimer', id: 'disclaimer' });

  const page = h('div', {},
    h('header', { class: 'page-head' },
      h('h1', { class: 'page-head__title', text: meta.title }),
      summary),
    buildToolbar(),
    listHost,
    disclaimer);

  paint();
  if (state.selectedId != null) openDetail(state.selectedId, { focus: false });
  return page;

  // ── 状態 ────────────────────────────────────────
  function normalize(r) {
    const dueISO = r.dueISO ?? null;
    const startISO = r.periodStartISO ?? null;
    const endISO = r.periodEndISO ?? null;
    return {
      id: r.id,
      title: r.title || '',
      status: r.status || '',
      dueISO,
      createdISO: r.createdAtISO ?? null,
      startISO,
      endISO,
      periodText: r.period
        || (startISO && endISO ? `${fmtShort(startISO)} – ${fmtShort(endISO)}` : ''),
      dueText: r.due || fmtDate(dueISO),
      createdText: r.createdAt || fmtDate(r.createdAtISO),
      body: r.body ?? '',
      lockedBy: r.lockedBy || null
    };
  }

  function sortValue(r) {
    switch (state.sortKey) {
      case 'title': return r.title;
      case 'periodStart': return r.startISO || r.periodText;
      case 'status': return r.status;
      case 'createdAt': return r.createdISO || r.createdText;
      default: return r.dueISO || r.dueText;
    }
  }

  function filtering() {
    return state.q.trim() !== '' || state.status !== 'all';
  }

  function visible() {
    const q = state.q.trim().toLowerCase();
    const dir = state.sortDir === 'asc' ? 1 : -1;
    return rows
      .filter((r) => {
        if (state.status !== 'all' && r.status !== state.status) return false;
        if (q && !r.title.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const x = sortValue(a) ?? '';
        const y = sortValue(b) ?? '';
        if (x === y) return (a.id ?? 0) - (b.id ?? 0);
        return (x > y ? 1 : -1) * dir;
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
    state.sortDir = p.get('sort_direction') === 'desc' ? 'desc' : 'asc';
    const id = Number(p.get('report_id'));
    state.selectedId = Number.isFinite(id) && id > 0 ? id : null;
  }

  function syncUrl() {
    const p = new URLSearchParams();
    if (state.q.trim()) p.set('q', state.q.trim());
    if (state.status !== 'all') p.set('status', state.status);
    p.set('sort_by', state.sortKey);
    p.set('sort_direction', state.sortDir);
    if (state.selectedId) p.set('report_id', state.selectedId);
    if (ctx.demo) p.set('demo', '1');
    history.replaceState(null, '', `${location.pathname}?${p}`);
  }

  // ── ツールバー ──────────────────────────────────
  function buildToolbar() {
    const search = h('input', {
      class: 'input', type: 'search', id: 'q', name: 'q',
      placeholder: '第 3 週', autocomplete: 'off', 'aria-describedby': 'q-hint',
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
      ['due:asc', '期限が近い順'], ['due:desc', '期限が遠い順'],
      ['createdAt:desc', '作成が新しい順'], ['createdAt:asc', '作成が古い順'],
      ['title:asc', 'タイトル順']
    ].map(([value, label]) => h('option', {
      value, selected: value === `${state.sortKey}:${state.sortDir}`
    }, label)));

    return h('div', { class: 'toolbar' },
      h('div', { class: 'field field--search' },
        h('label', { class: 'field__label', for: 'q', text: 'タイトルで絞り込み' }),
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
        caption: '週報の一覧。列見出しのボタンで並べ替えできます。行を開くと右に詳細が出ます。',
        columns: [
          { key: 'title', label: 'タイトル', className: 'table__th--title' },
          { key: 'periodStart', label: '期間', className: 'table__th--period' },
          { key: 'status', label: 'ステータス', className: 'table__th--status' },
          { key: 'due', label: '期限', className: 'table__th--due' },
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
        rows: list.map((r) => {
          const due = dueCell(r.dueISO, r.dueText, { done: r.status === '完了', today });
          return {
            id: r.id,
            idPrefix: 'report',       // 元 UI の行 ID 規約を保つ
            selected: r.id === state.selectedId,
            onOpen: (id) => openDetail(id),
            cells: [
              { label: 'タイトル', value: r.title },
              { label: '期間', value: r.periodText, className: 'cell--num' },
              { label: 'ステータス', value: statusPill(r.status) },
              { label: '期限', value: due.nodes, className: 'cell--num', tone: due.tone },
              { label: '作成日', value: r.createdText, className: 'cell--num' }
            ]
          };
        })
      }));
      wireKeyboard();
    } else {
      // 絞り込みで 0 件になったのか、そもそも 0 件なのかを言い分ける
      listHost.replaceChildren(filtering()
        ? emptyBlock({
          title: '条件に合う週報がありません',
          body: '検索語やステータスを変えてみてください。',
          actionLabel: '絞り込みを解除',
          onAction: resetFilters
        })
        : emptyBlock(emptyText));
    }

    countEl.textContent = filtering()
      ? `${list.length} / ${rows.length} 件`
      : `${rows.length} 件`;

    const counts = serverCounts || {
      未完了: rows.filter((r) => r.status === '未完了').length,
      完了: rows.filter((r) => r.status === '完了').length,
      合計: rows.length
    };
    summary.replaceChildren(...[
      ['未完了', counts.未完了 ?? 0, ''],
      ['完了', counts.完了 ?? 0, ''],
      ['合計', counts.合計 ?? rows.length, 'summary__item--total']
    ].map(([label, value, extra]) => h('div', { class: `summary__item ${extra}`.trim() },
      h('dt', { class: 'summary__label', text: label }),
      h('dd', { class: 'summary__value', text: String(value) }))));

    // 注記は出どころに合わせて書き分ける。実データを「ダミー」と書くと嘘になる。
    disclaimer.textContent = ctx.demo
      ? 'これは UI 改善の検証用のフォークです。表示しているデータはダミーで、'
        + 'ステータスは元アプリで確認できた「未完了 / 完了」の 2 値だけを使っています。'
      : 'これは UI 改善の検証用のフォークです。一覧は元アプリの週報一覧をそのまま読んで'
        + '表示しています。ステータスは元アプリで確認できた「未完了 / 完了」の 2 値だけを'
        + '使い、本文は一覧の HTML に含まれないため読み取り専用です。';
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

  // ── 詳細パネル ──────────────────────────────────
  function openDetail(id, { focus = true } = {}) {
    const r = rows.find((x) => x.id === id);
    if (!r) return;

    state.selectedId = id;
    paint();
    syncUrl();

    const rest = dueRest(r.dueISO, today);
    const locked = Boolean(r.lockedBy) || !editable;

    const saveState = h('span', {
      class: 'save-state', id: 'save-state', dataset: { state: 'idle' },
      text: editable ? '変更は自動で保存されます' : ''
    });

    let saveTimer = null;
    const textarea = h('textarea', {
      class: 'input textarea', id: 'panel-text', rows: 8,
      'aria-describedby': 'panel-text-hint',
      readonly: locked || null,
      placeholder: editable && !r.body ? 'この週にやったことを書く' : null,
      oninput: (e) => {
        r.body = e.target.value;
        saveState.dataset.state = 'saving';
        saveState.textContent = '保存中…';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveState.dataset.state = 'saved';
          saveState.textContent = '保存しました';
        }, 500);
      }
    });
    textarea.value = r.body || '';

    const body = [
      metaList([
        ['期間', r.startISO && r.endISO
          ? `${fmtDate(r.startISO)} – ${fmtDate(r.endISO)}` : (r.periodText || '—')],
        ['ステータス', statusPill(r.status)],
        ['期限', rest && r.status !== '完了'
          ? `${r.dueText}（${rest.glyph ? `${rest.glyph} ` : ''}${rest.text}）`
          : (r.dueText || '—')],
        ['作成日', r.createdText || '—']
      ]),
      h('div', { class: 'field' },
        h('label', { class: 'field__label', for: 'panel-text', text: '本文' }),
        textarea,
        h('p', { class: 'field__hint', id: 'panel-text-hint' }, saveState)),
      locked && h('p', { class: 'lock', id: 'panel-lock' },
        h('span', { 'aria-hidden': 'true', text: '●' }),
        h('span', {
          id: 'panel-lock-text',
          text: r.lockedBy
            ? `${r.lockedBy} さんが編集中のため読み取り専用です`
            : '本文は元アプリの一覧からは取得できないため読み取り専用です'
        }))
    ];

    const save = h('button', {
      class: 'btn btn--primary', type: 'button', id: 'panel-save',
      onclick: () => {
        save.dataset.state = 'loading';
        setTimeout(() => {
          save.dataset.state = 'success';
          saveState.dataset.state = 'saved';
          saveState.textContent = '保存しました';
          setTimeout(() => { delete save.dataset.state; }, 1200);
        }, 400);
      }
    }, '保存');

    panel.open({
      eyebrow: '週報',
      title: r.title,
      body,
      actions: [
        save,
        h('button', {
          class: 'btn btn--secondary', type: 'button', id: 'panel-cancel',
          onclick: () => panel.close()
        }, '閉じる'),
        h('button', {
          class: 'btn btn--danger', type: 'button', id: 'panel-delete',
          onclick: () => removeReport(id)
        }, '削除')
      ],
      onClose: () => {
        state.selectedId = null;
        paint();
        syncUrl();
        // フォーカスを呼び出した行へ返す
        return listHost.querySelector(`#report_${id} .row__open`);
      }
    });

    if (!focus) document.activeElement?.blur?.();
  }

  // 削除は確認せず実行して、元に戻せるようにする
  function removeReport(id) {
    const index = rows.findIndex((x) => x.id === id);
    if (index < 0) return;
    const [removed] = rows.splice(index, 1);

    state.selectedId = null;
    panel.close();
    paint();
    syncUrl();

    toasts.push(`「${removed.title}」を削除しました`, {
      label: '元に戻す',
      run: () => { rows.splice(index, 0, removed); paint(); }
    });
  }
}

/** `/` で検索欄へ。画面をまたいで同じ挙動にするため入口はここ 1 箇所。 */
document.addEventListener('keydown', (e) => {
  if (e.key !== '/') return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (typing) return;
  const search = document.getElementById('q');
  if (!search) return;
  e.preventDefault();
  search.focus();
  search.select();
});
