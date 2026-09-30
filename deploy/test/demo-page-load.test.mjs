/* 各画面の load() がデモ時も opts（refresh）を demo.js に渡すこと。
 * 渡さないと裏更新が live にならず、キャッシュ表示のまま固まる。
 * pages/*.js は document に触るので、ここではソースを読む。 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(here, '../../fork/pages');

const pages = [
  ['dashboard', 'demoDashboard'],
  ['orders', 'demoOrders'],
  ['equipments', 'demoEquipments'],
  ['loans', 'demoLoans'],
  ['reports', 'demoReports'],
  ['notifications', 'demoNotifications']
];

describe('demo page.load が refresh を渡す', () => {
  for (const [name, demoFn] of pages) {
    test(`${name}.js は ${demoFn}(opts) を呼ぶ`, () => {
      const src = readFileSync(join(pagesDir, `${name}.js`), 'utf8');
      assert.match(
        src,
        new RegExp(`ctx\\.demo\\s*\\?\\s*${demoFn}\\(opts\\)`),
        `${name}.js が ${demoFn}() に opts を渡していない`
      );
      assert.doesNotMatch(
        src,
        new RegExp(`${demoFn}\\(\\)`),
        `${name}.js に ${demoFn}() のまま（opts なし）が残っている`
      );
    });
  }
});
