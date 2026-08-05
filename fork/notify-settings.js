/* 通知の届け先設定。レールからパネルを開く。
 *
 * Webhook URL は端末の localStorage だけに置き、サーバには送らない
 * （送信の瞬間に Worker へ渡すだけ）。
 */

import {
  loadPrefs, requestBrowserPermission, savePrefs
} from './notify.js';
import { h, panel, toasts } from './ui.js';

export function openNotifySettings({ watcher, isDemo }) {
  const prefs = loadPrefs();
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
  const error = h('p', { class: 'signin__error', id: 'notify-error', hidden: true });

  const saveBtn = h('button', {
    class: 'btn btn--primary', type: 'button', id: 'notify-save',
    onclick: async () => {
      error.hidden = true;
      let browser = browserToggle.checked;
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

      const webhookUrl = webhookInput.value.trim();
      if (discordToggle.checked && !webhookUrl) {
        error.textContent = 'Discord を使うときは Webhook URL が必要です。';
        error.hidden = false;
        webhookInput.focus();
        return;
      }

      savePrefs({
        browser,
        discord: discordToggle.checked,
        webhookUrl
      });
      toasts.push('届け先の設定を保存しました');
      panel.close();
    }
  }, '保存する');

  const testBtn = h('button', {
    class: 'btn btn--secondary', type: 'button', id: 'notify-test',
    onclick: async () => {
      error.hidden = true;
      // テスト前に今の入力を一時反映（未保存でも試せる）
      savePrefs({
        browser: browserToggle.checked,
        discord: discordToggle.checked,
        webhookUrl: webhookInput.value.trim()
      });
      const current = loadPrefs();
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
        await watcher.sendTest();
        toasts.push('テスト通知を送りました');
      } catch (e) {
        error.textContent = e.message || '送信に失敗しました';
        error.hidden = false;
      } finally {
        delete testBtn.dataset.state;
      }
    }
  }, 'テスト送信');

  panel.open({
    eyebrow: '設定',
    title: '変更通知の届け先',
    body: [
      h('p', {
        class: 'item__body',
        text: '元アプリに新しい通知が届いたら、この端末のブラウザ通知と Discord に転送します。'
          + ' Webhook URL はこのブラウザにだけ保存し、サーバには残しません。'
      }),
      h('div', { class: 'notify-settings' },
        h('label', { class: 'switch' },
          browserToggle,
          h('span', { class: 'switch__ui', 'aria-hidden': 'true' }),
          h('span', { class: 'switch__label', text: 'ブラウザに通知する' })),
        status,
        h('label', { class: 'switch' },
          discordToggle,
          h('span', { class: 'switch__ui', 'aria-hidden': 'true' }),
          h('span', { class: 'switch__label', text: 'Discord に送る' })),
        h('div', { class: 'field' },
          h('label', { class: 'field__label', for: 'notify-webhook', text: 'Discord Webhook URL' }),
          webhookInput,
          h('p', {
            class: 'field__hint',
            text: 'チャンネル設定 → 連携サービス → ウェブフック で発行した URL'
          })),
        error)
    ],
    actions: [testBtn, saveBtn]
  });
}

function permissionLabel(permission, isDemo) {
  if (isDemo) return 'デモモードでもテスト送信はできます（未読の監視はデモ件数を使います）。';
  if (permission === 'granted') return 'ブラウザ通知は許可されています。';
  if (permission === 'denied') return 'ブラウザ通知は拒否されています。';
  if (permission === 'unsupported') return 'このブラウザは通知 API に対応していません。';
  return 'ブラウザ通知は、オンにして保存すると許可を求めます。';
}
