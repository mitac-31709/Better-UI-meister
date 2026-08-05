/* 通知の届け先設定（通知画面に埋め込む）。
 *
 * 初回表示だけフォームを開いて機能を見せる。閉じる／保存したら
 * 「見た」と覚え、以降は折りたたみ（どちらもオフのままでも可）。
 * ブラウザ通知はタブが開いている間だけ、という制限もここに書いておく。
 *
 * Discord をオンにして保存するときは:
 *   1. テストメッセージを送り、届くこと確認する
 *   2. バックグラウンド購読を Worker（KV）に登録する（タブを閉じても送る）
 *
 * Webhook URL のコピーは端末の localStorage にも残す。
 * バックグラウンド用の正本は Worker の KV（封印済み）。オフにすると消す。
 */

import { api, Unauthenticated } from './api.js';
import {
  hasSeenDeliveryIntro, loadPrefs, markDeliveryIntroSeen,
  requestBrowserPermission, savePrefs
} from './notify.js';
import { h, toasts } from './ui.js';

/** 通知一覧の上に置く届け先セクション。
 *  初回だけ開く。閉じる／保存後は折りたたみ。 */
export function renderNotifySettings({ watcher, isDemo }) {
  const prefs = loadPrefs();
  const openInitially = !hasSeenDeliveryIntro();
  const permission = typeof Notification === 'undefined'
    ? 'unsupported'
    : Notification.permission;

  const browserToggle = h('input', {
    type: 'checkbox', id: 'notify-browser', class: 'switch__input',
    checked: prefs.browser || null
  });
  const discordToggle = h('input', {
    type: 'checkbox', id: 'notify-discord', class: 'switch__input',
    checked: prefs.discord || null
  });
  const webhookInput = h('input', {
    class: 'input', type: 'url', id: 'notify-webhook',
    placeholder: 'https://discord.com/api/webhooks/…',
    value: prefs.webhookUrl,
    autocomplete: 'off', spellcheck: 'false'
  });
  const status = h('p', {
    class: 'field__hint', id: 'notify-status',
    text: permissionLabel(permission, isDemo)
  });
  const error = h('p', { class: 'notify-settings__error', id: 'notify-error', hidden: true });
  const ok = h('p', { class: 'notify-settings__ok', id: 'notify-ok', hidden: true });

  const saveBtn = h('button', {
    class: 'btn btn--primary', type: 'button', id: 'notify-save',
    onclick: async () => {
      error.hidden = true;
      ok.hidden = true;
      let browser = browserToggle.checked;
      const wantDiscord = discordToggle.checked;
      const webhookUrl = webhookInput.value.trim();
      const prev = loadPrefs();

      if (browser) {
        const result = await requestBrowserPermission();
        status.textContent = permissionLabel(result.permission, isDemo);
        if (!result.ok) {
          browser = false;
          browserToggle.checked = false;
          if (result.permission === 'denied') {
            error.textContent = 'ブラウザが通知を拒否しています。サイト設定から許可してください。';
            error.hidden = false;
          } else if (result.permission === 'unsupported') {
            error.textContent = 'このブラウザは通知 API に対応していません。';
            error.hidden = false;
          }
        }
      }

      if (wantDiscord && !webhookUrl) {
        error.textContent = 'Discord を使うときは Webhook URL が必要です。';
        error.hidden = false;
        webhookInput.focus();
        return;
      }

      let subscriptionId = prev.subscriptionId;

      if (wantDiscord) {
        saveBtn.dataset.state = 'loading';
        try {
          await watcher.verifyDiscord(webhookUrl);
          try {
            const sub = await api.subscribeNotify(webhookUrl, subscriptionId);
            subscriptionId = sub.id;
          } catch (e) {
            if (e instanceof Unauthenticated) {
              throw new Error('バックグラウンド配信の登録にはログインが必要です');
            }
            throw e;
          }
        } catch (e) {
          error.textContent = discordErrorMessage(e);
          error.hidden = false;
          webhookInput.focus();
          return;
        } finally {
          delete saveBtn.dataset.state;
        }
      } else if (subscriptionId) {
        try {
          await api.unsubscribeNotify(subscriptionId);
        } catch {
          // 消せるだけ消す
        }
        subscriptionId = null;
      }

      const next = savePrefs({
        browser,
        discord: wantDiscord,
        webhookUrl,
        subscriptionId
      });
      summary.textContent = summaryLabel(next);
      bgNote.textContent = backgroundNote(next);
      markDeliveryIntroSeen();
      collapsePanel();

      if (wantDiscord) {
        ok.textContent = 'Discord にテスト通知を送り、タブを閉じても送る設定を登録しました。'
          + ' チャンネルにテストが届いていれば連携は成功です。';
        ok.hidden = false;
        toasts.push('Discord 連携とバックグラウンド配信を登録しました');
      } else {
        toasts.push('届け先の設定を保存しました');
      }
    }
  }, '保存する');

  const testBtn = h('button', {
    class: 'btn btn--secondary', type: 'button', id: 'notify-test',
    onclick: async () => {
      error.hidden = true;
      ok.hidden = true;
      const wantDiscord = discordToggle.checked;
      const webhookUrl = webhookInput.value.trim();
      const prev = loadPrefs();
      savePrefs({
        browser: browserToggle.checked,
        discord: wantDiscord,
        webhookUrl,
        subscriptionId: prev.subscriptionId
      });
      const current = loadPrefs();
      summary.textContent = summaryLabel(current);
      if (!current.browser && !current.discord) {
        error.textContent = 'ブラウザか Discord のどちらかをオンにしてください。';
        error.hidden = false;
        return;
      }
      if (current.browser) {
        const result = await requestBrowserPermission();
        status.textContent = permissionLabel(result.permission, isDemo);
        if (!result.ok) {
          error.textContent = 'ブラウザ通知の許可が必要です。';
          error.hidden = false;
          return;
        }
      }
      if (current.discord && !current.webhookUrl) {
        error.textContent = 'Discord の Webhook URL を入力してください。';
        error.hidden = false;
        return;
      }
      try {
        testBtn.dataset.state = 'loading';
        if (current.discord) {
          await watcher.verifyDiscord(current.webhookUrl);
        }
        if (current.browser) {
          await watcher.sendTest(undefined, { browser: true, discord: false });
        }
        if (current.discord) {
          ok.textContent = 'Discord にテスト通知を送りました。チャンネルを確認してください。';
          ok.hidden = false;
        }
        toasts.push(current.discord
          ? 'Discord へのテスト送信に成功しました'
          : 'テスト通知を送りました');
      } catch (e) {
        error.textContent = discordErrorMessage(e);
        error.hidden = false;
      } finally {
        delete testBtn.dataset.state;
      }
    }
  }, 'テスト送信');

  const bgNote = h('p', {
    class: 'field__hint', id: 'notify-bg-status',
    text: backgroundNote(prefs)
  });

  const panel = h('div', {
    class: 'notify-delivery__panel',
    id: 'notify-settings-panel',
    // 初回だけ開く。閉じる／保存で「見た」と覚え、以降は折りたたむ。
    hidden: openInitially ? null : true
  },
  h('p', {
    class: 'notify-delivery__lede',
    text: '新しい通知が来たとき、この端末のブラウザと Discord へ転送できます。'
      + ' Discord は保存時にテストし、成功したらタブを閉じても送る登録をします。'
  }),
  h('div', { class: 'notify-settings' },
    h('label', { class: 'switch' },
      browserToggle,
      h('span', { class: 'switch__ui', 'aria-hidden': 'true' }),
      h('span', { class: 'switch__label', text: 'ブラウザに通知する' })),
    status,
    h('div', {
      class: 'notify-limits',
      id: 'notify-browser-limits',
      role: 'note',
      'aria-label': 'ブラウザ通知の制限'
    },
      h('p', { class: 'notify-limits__title', text: 'ブラウザ通知の制限' }),
      h('ul', { class: 'notify-limits__list' },
        h('li', { text: 'このサイトのタブ（ページ）が開いている間だけ届きます。閉じると止まります。' }),
        h('li', { text: 'ブラウザ／OS の通知許可が必要です。' }),
        h('li', { text: '表示中は約 60 秒ごと、裏タブでは約 5 分ごとに未読を確認します。' }),
        h('li', { text: 'ログイン直後の既存未読は送りません（その後に増えた分だけ）。' }),
        h('li', { text: 'タブを閉じたあとも欲しければ Discord を使ってください。' }))),
    h('label', { class: 'switch' },
      discordToggle,
      h('span', { class: 'switch__ui', 'aria-hidden': 'true' }),
      h('span', { class: 'switch__label', text: 'Discord に送る（タブを閉じても可）' })),
    bgNote,
    h('div', { class: 'field' },
      h('label', { class: 'field__label', for: 'notify-webhook', text: 'Discord Webhook URL' }),
      webhookInput,
      h('p', {
        class: 'field__hint',
        text: 'チャンネル設定 → 連携サービス → ウェブフック。保存時にテスト送信と登録をします。'
      })),
    error,
    ok,
    h('div', { class: 'notify-settings__actions' }, testBtn, saveBtn)));

  const summary = h('p', {
    class: 'notify-delivery__summary',
    id: 'notify-delivery-summary',
    text: summaryLabel(prefs)
  });

  function collapsePanel() {
    panel.hidden = true;
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.textContent = '設定する';
  }

  function expandPanel() {
    panel.hidden = false;
    toggleBtn.setAttribute('aria-expanded', 'true');
    toggleBtn.textContent = '閉じる';
  }

  const toggleBtn = h('button', {
    class: 'btn btn--secondary btn--compact',
    type: 'button',
    id: 'notify-settings-toggle',
    'aria-expanded': openInitially ? 'true' : 'false',
    'aria-controls': 'notify-settings-panel',
    onclick: () => {
      if (panel.hidden) {
        expandPanel();
      } else {
        markDeliveryIntroSeen();
        collapsePanel();
      }
    }
  }, openInitially ? '閉じる' : '設定する');

  return h('section', {
    class: 'notify-delivery',
    id: 'notify-settings',
    'aria-labelledby': 'notify-delivery-title'
  },
  h('div', { class: 'notify-delivery__bar' },
    h('div', { class: 'notify-delivery__intro' },
      h('h2', { class: 'notify-delivery__title', id: 'notify-delivery-title', text: '届け先' }),
      summary),
    toggleBtn),
  panel);
}

function summaryLabel(prefs) {
  const parts = [];
  if (prefs.browser) parts.push('ブラウザ');
  if (prefs.discord) parts.push('Discord');
  if (!parts.length) return 'オフ';
  return `${parts.join(' · ')} に転送`;
}

function backgroundNote(prefs) {
  if (prefs.subscriptionId) {
    return 'バックグラウンド配信は登録済みです（1 時間間隔。元アプリのセッションが有効な間）。';
  }
  return 'Discord を保存すると、タブを閉じても Worker が 1 時間おきに未読を見て送ります。';
}

function permissionLabel(permission, isDemo) {
  if (isDemo) {
    return 'デモでもテスト送信はできます。バックグラウンド登録にはログイン（Worker）が必要です。';
  }
  if (permission === 'granted') return 'ブラウザ通知は許可されています。';
  if (permission === 'denied') return 'ブラウザ通知は拒否されています。';
  if (permission === 'unsupported') return 'このブラウザは通知 API に対応していません。';
  return 'ブラウザ通知は、オンにして保存すると許可を求めます。';
}

function discordErrorMessage(e) {
  const msg = e?.message || String(e || '');
  if (!msg || msg === 'Error') {
    return 'Discord へのテスト送信に失敗しました。Webhook URL を確認してください。';
  }
  if (/Discord|Webhook|webhook|401|403|404|502/.test(msg)) {
    return `${msg}（Webhook URL を確認してください）`;
  }
  return msg;
}
