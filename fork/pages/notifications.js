/* 通知。
 *
 * 元アプリは 1 列のリストで、未読数の表示枠は空のこともある（取得できた
 * アカウントでは空だった）。既読・未読が判別できるのは値が真偽値のときだけで、
 * null は「わからない」なので、未読の印も状態の文字も出さない。
 *
 * 既読にする口（`PATCH /notifications/:id/mark_as_read`）はこのフォークから
 * 叩いていない。読んだことにする副作用を、表示するだけの画面で起こさない。
 *
 * 画面上部に届け先（ブラウザ / Discord）の入口を置く。初回だけ開いて
 * 機能を見せ、閉じる／保存後は折りたたむ（どちらもオフのままでも可）。
 */

import { api } from '../api.js';
import { demoNotifications } from '../demo.js';
import { fmtDate } from '../format.js';
import { renderNotifySettings } from '../notify-settings.js';
import { emptyBlock, h, metaList, panel } from '../ui.js';

export const meta = { route: '/notifications', nav: '通知', title: '通知' };

export async function load(ctx) {
  return ctx.demo ? demoNotifications() : api.notifications();
}

export function render(data, ctx) {
  const items = (data.notifications || []).map(normalize);
  const unread = typeof data.unreadText === 'string' ? data.unreadText.trim() : '';
  const empty = data.empty || {};

  return h('div', {},
    h('header', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-head__title', text: data.heading || meta.title }),
        unread ? h('p', { class: 'page-head__lede', text: unread }) : null)),
    ctx?.watcher
      ? renderNotifySettings({ watcher: ctx.watcher, isDemo: ctx.demo })
      : null,
    h('section', { class: 'notify-list', 'aria-label': '通知一覧' },
      items.length
        ? h('div', { class: 'itemlist' }, items.map(row))
        : emptyBlock({
          title: empty.title || '通知はありません',
          body: empty.body || '新しい通知が届くとここに表示されます。'
        })));
}

function normalize(n) {
  return {
    id: n.id,
    title: n.title || '',
    body: n.body || '',
    atText: n.at || fmtDate(n.atISO),
    // 真偽値のときだけ既読・未読を語る。null は元 HTML から読み取れなかった印。
    read: typeof n.read === 'boolean' ? n.read : null
  };
}

function row(n) {
  return h('button', {
    class: `item item--button${n.read === false ? ' item--unread' : ''}`,
    type: 'button',
    id: n.id != null ? `notification_${n.id}` : null,
    onclick: () => openDetail(n)
  },
  h('span', { class: 'item__title', text: n.title }),
  n.atText ? h('span', { class: 'item__meta', text: n.atText }) : null,
  n.body ? h('span', { class: 'item__body', text: n.body }) : null);
}

function openDetail(n) {
  panel.open({
    eyebrow: '通知',
    title: n.title,
    body: [
      metaList([
        ['日時', n.atText || '—'],
        ['状態', n.read == null ? '—' : (n.read ? '既読' : '未読')]
      ]),
      n.body ? h('p', { class: 'item__body', text: n.body }) : null
    ],
    actions: [
      h('button', {
        class: 'btn btn--secondary', type: 'button', id: 'panel-cancel',
        onclick: () => panel.close()
      }, '閉じる')
    ]
  });
}
